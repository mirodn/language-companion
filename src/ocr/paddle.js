// Finds and reads text in images with PaddleOCR's PP-OCRv5 mobile models on onnxruntime-web.
// Images are plain { data: RGBA bytes, width, height } objects, so this runs in pages, workers and Node.
// Pre- and post-processing follow PaddleOCR's own pipeline: DB text detection, then CTC line recognition.

const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];
const REC_MEAN = [0.5, 0.5, 0.5];
const REC_STD = [0.5, 0.5, 0.5];

const PIXEL_THRESHOLD = 0.3;  // probability above which a pixel counts as text
const BOX_THRESHOLD = 0.6;    // mean probability a region needs to count as a text line
const UNCLIP_RATIO = 1.5;     // the model predicts shrunken regions; this grows them back
const MIN_BOX_SIDE = 3;

const REC_HEIGHT = 48;
const REC_MIN_WIDTH = 320;
const REC_MAX_WIDTH = 3200;
const REC_BATCH = 8;
const VERTICAL_RATIO = 1.5;   // lines this much taller than wide are read top to bottom
const MIN_LINE_SCORE = 0.5;   // lines read with less confidence are usually not text at all

// Manga columns: the detector often puts furigana and neighbouring columns into one box.
const INK_LEVEL = 110;        // pixels darker than this (0–255 grey) count as ink
const COLUMN_INK = 0.02;      // share of a pixel column's height that must be ink
const MAIN_COLUMN = 0.6;      // ink bands narrower than this share of the widest are furigana
const NARROW_LINE = 0.55;     // vertical lines narrower than this share of the median are furigana
const CJK = /[぀-ヿ㐀-鿿가-힯]/;

// Tall images (webtoon strips) are detected in tiles about this much taller than wide.
const TILE_ASPECT = 1.5;
const TILE_OVERLAP = 0.25;

// Without recModel, only detect() works: for languages read by another model (see manga-ocr.js).
export async function createOcr(ort, { detModel, recModel, dict, sessionOptions = {} }) {
  const det = await ort.InferenceSession.create(detModel, sessionOptions);
  const rec = recModel ? await ort.InferenceSession.create(recModel, sessionOptions) : null;

  // Finds the text lines in an image, without reading them.
  async function detect(image, { maxSide = 960 } = {}) {
    const boxes = [];
    for (const tile of tiles(image)) {
      const scale = Math.min(1, maxSide / Math.max(tile.width, tile.height));
      const width = Math.max(32, Math.round(tile.width * scale / 32) * 32);
      const height = Math.max(32, Math.round(tile.height * scale / 32) * 32);
      const input = toTensor(image, tile, width, height, DET_MEAN, DET_STD, false);
      const output = await det.run({ [det.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, height, width]) });
      const probs = output[det.outputNames[0]].data;
      for (const box of findBoxes(probs, width, height)) {
        const mapped = {
          x: tile.x + box.x * tile.width / width,
          y: tile.y + box.y * tile.height / height,
          width: box.width * tile.width / width,
          height: box.height * tile.height / height,
        };
        const centre = mapped.y + mapped.height / 2;
        if (centre >= tile.keepFrom && centre < tile.keepTo) boxes.push(clampBox(mapped, image));
      }
    }
    const lines = boxes.flatMap((box) => box.height >= box.width * VERTICAL_RATIO
      ? splitColumns(image, box).map((column) => ({ box: column, vertical: true }))
      : [{ box, vertical: false }]);
    return dropNarrowColumns(lines);
  }

  // Reads lines found by detect(). Lines that turn out not to be text are left out.
  async function read(image, found) {
    const lines = found.map((line) => ({ ...line }));
    // Reading lines of similar shape together keeps the padding in each batch small.
    const order = lines.map((line, i) => i).sort((a, b) => aspect(lines[a]) - aspect(lines[b]));
    for (let start = 0; start < order.length; start += REC_BATCH) {
      const batch = order.slice(start, start + REC_BATCH).map((i) => lines[i]);
      const widths = batch.map((line) => Math.min(REC_MAX_WIDTH, Math.ceil(REC_HEIGHT * aspect(line))));
      const batchWidth = Math.max(REC_MIN_WIDTH, ...widths);
      const plane = REC_HEIGHT * batchWidth;
      const input = new Float32Array(batch.length * 3 * plane);
      batch.forEach((line, n) => {
        const pixels = toTensor(image, line.box, widths[n], REC_HEIGHT, REC_MEAN, REC_STD, line.vertical);
        for (let c = 0; c < 3; c++) {
          for (let y = 0; y < REC_HEIGHT; y++) {
            const from = c * REC_HEIGHT * widths[n] + y * widths[n];
            input.set(pixels.subarray(from, from + widths[n]), (n * 3 + c) * plane + y * batchWidth);
          }
        }
      });
      const output = await rec.run({ [rec.inputNames[0]]: new ort.Tensor("float32", input, [batch.length, 3, REC_HEIGHT, batchWidth]) });
      const { data, dims } = output[rec.outputNames[0]];
      batch.forEach((line, n) => Object.assign(line, decode(data, n, dims[1], dims[2], dict)));
    }
    // Short lines without any Japanese or Korean are usually bits of the drawing.
    const text = lines.filter((line) => line.text && line.score >= MIN_LINE_SCORE && (CJK.test(line.text) || line.text.length > 2));
    return dropOverlapping(text);
  }

  return {
    detect,
    read,
    // Finds and reads every line: its box in image pixels, its text and a 0–1 confidence.
    async recognize(image, options) {
      const started = performance.now();
      const found = await detect(image, options);
      const detected = performance.now();
      const lines = await read(image, found);
      const done = performance.now();
      return { lines, timings: { detect: detected - started, read: done - detected, total: done - started } };
    },
    async release() {
      await det.release();
      await rec?.release();
    },
  };
}

// Width over height of the line as the recognizer sees it, after turning vertical lines.
function aspect({ box, vertical }) {
  return vertical ? box.height / box.width : box.width / box.height;
}

// Splits images much taller than wide into overlapping tiles. Each tile keeps only the boxes
// centred in its own part, so a line cut by one tile's edge is found whole by the next.
function tiles({ width, height }) {
  const tileHeight = Math.round(width * TILE_ASPECT);
  if (height <= tileHeight * 1.2) return [{ x: 0, y: 0, width, height, keepFrom: 0, keepTo: height }];
  const overlap = Math.round(tileHeight * TILE_OVERLAP);
  const step = tileHeight - overlap;
  const result = [];
  for (let y = 0; y < height; y += step) {
    const bottom = Math.min(height, y + tileHeight);
    const top = Math.max(0, bottom - tileHeight);
    result.push({
      x: 0, y: top, width, height: bottom - top,
      keepFrom: top === 0 ? 0 : top + overlap / 2,
      keepTo: bottom === height ? height : bottom - overlap / 2,
    });
    if (bottom === height) break;
  }
  return result;
}

// Resizes a region of the image (bilinear) into a normalised CHW float tensor in BGR order,
// which is the channel order PaddleOCR's models were trained on. When `rotate` is set, the region
// is first turned 90° counter-clockwise, so a vertical line reads left to right.
function toTensor(image, region, outWidth, outHeight, mean, std, rotate) {
  const { data, width, height } = image;
  const plane = outWidth * outHeight;
  const tensor = new Float32Array(3 * plane);
  const srcWidth = rotate ? region.height : region.width;
  const srcHeight = rotate ? region.width : region.height;
  for (let y = 0; y < outHeight; y++) {
    const v = (y + 0.5) * srcHeight / outHeight;
    for (let x = 0; x < outWidth; x++) {
      const u = (x + 0.5) * srcWidth / outWidth;
      const sx = region.x + (rotate ? region.width - v : u) - 0.5;
      const sy = region.y + (rotate ? u : v) - 0.5;
      const x0 = Math.max(0, Math.min(width - 1, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(height - 1, Math.floor(sy)));
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));
      const fy = Math.max(0, Math.min(1, sy - y0));
      const i00 = (y0 * width + x0) * 4, i10 = (y0 * width + x1) * 4;
      const i01 = (y1 * width + x0) * 4, i11 = (y1 * width + x1) * 4;
      const out = y * outWidth + x;
      for (let c = 0; c < 3; c++) {
        const rgb = 2 - c;  // tensor channel 0 is blue
        const top = data[i00 + rgb] + (data[i10 + rgb] - data[i00 + rgb]) * fx;
        const bottom = data[i01 + rgb] + (data[i11 + rgb] - data[i01 + rgb]) * fx;
        const value = (top + (bottom - top) * fy) / 255;
        tensor[c * plane + out] = (value - mean[c]) / std[c];
      }
    }
  }
  return tensor;
}

// Groups text pixels of the probability map into boxes: connected regions above the pixel
// threshold, kept when confident enough, then grown by the unclip distance as PaddleOCR does.
function findBoxes(probs, width, height) {
  const seen = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  const boxes = [];
  for (let start = 0; start < probs.length; start++) {
    if (seen[start] || probs[start] <= PIXEL_THRESHOLD) continue;
    let size = 0, sum = 0, top = 0;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    seen[start] = 1;
    stack[top++] = start;
    while (top > 0) {
      const i = stack[--top];
      const x = i % width, y = (i - x) / width;
      size++;
      sum += probs[i];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const j = ny * width + nx;
          if (!seen[j] && probs[j] > PIXEL_THRESHOLD) {
            seen[j] = 1;
            stack[top++] = j;
          }
        }
      }
    }
    const boxWidth = maxX - minX + 1, boxHeight = maxY - minY + 1;
    if (Math.min(boxWidth, boxHeight) < MIN_BOX_SIDE || sum / size < BOX_THRESHOLD) continue;
    const grow = boxWidth * boxHeight * UNCLIP_RATIO / (2 * (boxWidth + boxHeight));
    if (Math.min(boxWidth, boxHeight) + 2 * grow < MIN_BOX_SIDE + 2) continue;
    boxes.push({ x: minX - grow, y: minY - grow, width: boxWidth + 2 * grow, height: boxHeight + 2 * grow });
  }
  return boxes;
}

// Splits a vertical box at the blank pixel columns inside it and keeps the full-width ink bands.
// This drops furigana printed beside the main text, which otherwise ruins the whole line, and
// separates neighbouring columns the detector merged.
function splitColumns(image, box) {
  const x0 = Math.floor(box.x), x1 = Math.ceil(box.x + box.width);
  const y0 = Math.floor(box.y), y1 = Math.ceil(box.y + box.height);
  const minInk = Math.max(1, (y1 - y0) * COLUMN_INK);
  const bands = [];
  for (let x = x0; x < x1; x++) {
    let ink = 0;
    for (let y = y0; y < y1; y++) if (isInk(image, x, y)) ink++;
    if (ink < minInk) continue;
    const last = bands[bands.length - 1];
    if (last && last.to === x) last.to = x + 1;
    else bands.push({ from: x, to: x + 1 });
  }
  if (bands.length < 2) return [box];
  const widest = Math.max(...bands.map((band) => band.to - band.from));
  return bands.filter((band) => band.to - band.from >= widest * MAIN_COLUMN).map((band) => {
    let top = y1, bottom = y0;
    for (let y = y0; y < y1; y++) {
      for (let x = band.from; x < band.to; x++) {
        if (!isInk(image, x, y)) continue;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        break;
      }
    }
    const pad = Math.max(2, (band.to - band.from) * 0.1);
    return clampBox({ x: band.from - pad, y: top - pad, width: band.to - band.from + 2 * pad, height: bottom - top + 1 + 2 * pad }, image);
  });
}

function isInk({ data, width }, x, y) {
  const i = (y * width + x) * 4;
  return data[i] + data[i + 1] + data[i + 2] < 3 * INK_LEVEL;
}

// Furigana the detector found on its own is much narrower than the page's usual column.
function dropNarrowColumns(lines) {
  const widths = lines.filter((line) => line.vertical).map((line) => line.box.width).sort((a, b) => a - b);
  if (widths.length < 3) return lines;
  const median = widths[widths.length >> 1];
  return lines.filter((line) => !line.vertical || line.box.width >= median * NARROW_LINE);
}

// Overlapping detections can yield the same line twice; keeps the more confident one.
function dropOverlapping(lines) {
  const kept = [];
  for (const line of [...lines].sort((a, b) => b.score - a.score)) {
    if (!kept.some((other) => overlap(line.box, other.box) > 0.5)) kept.push(line);
  }
  return lines.filter((line) => kept.includes(line));
}

// Shared area as a share of the smaller box.
function overlap(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  return width * height / Math.min(a.width * a.height, b.width * b.height);
}

function clampBox(box, { width, height }) {
  const x = Math.max(0, box.x), y = Math.max(0, box.y);
  return { x, y, width: Math.min(width, box.x + box.width) - x, height: Math.min(height, box.y + box.height) - y };
}

// Greedy CTC decoding: the best class per time step, dropping blanks (class 0) and repeats.
// Class k is dict[k - 1], and the last class is a space.
function decode(data, n, steps, classes, dict) {
  let text = "", total = 0, count = 0, previous = 0;
  for (let t = 0; t < steps; t++) {
    const offset = (n * steps + t) * classes;
    let best = 0, bestProb = data[offset];
    for (let k = 1; k < classes; k++) {
      if (data[offset + k] > bestProb) {
        best = k;
        bestProb = data[offset + k];
      }
    }
    if (best !== 0 && best !== previous) {
      text += best === classes - 1 ? " " : dict[best - 1];
      total += bestProb;
      count++;
    }
    previous = best;
  }
  return { text: text.trim(), score: count ? total / count : 0 };
}
