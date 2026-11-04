// Reads a whole block of Japanese manga text (a speech bubble) with manga-ocr
// (https://github.com/kha-white/manga-ocr) on onnxruntime-web. It was trained on manga, so it
// handles vertical text, manga lettering and furigana far better than general OCR, but it only
// reads: finding the bubbles is done by paddle.js. Images are { data: RGBA bytes, width, height }.

const SIZE = 224;
const START_TOKEN = 2;  // [CLS]
const END_TOKEN = 3;    // [SEP]
const MAX_TOKENS = 120;
// As in the original's generation settings: never repeat a sequence of three tokens.
const NO_REPEAT = 3;

export async function createMangaOcr(ort, { encoderModel, decoderModel, vocab, sessionOptions = {} }) {
  const encoder = await ort.InferenceSession.create(encoderModel, sessionOptions);
  const decoder = await ort.InferenceSession.create(decoderModel, sessionOptions);

  return {
    // Reads the text in `box` (image pixels). Returns "" when there is none.
    async read(image, box) {
      const pixels = new ort.Tensor("float32", toTensor(image, box), [1, 3, SIZE, SIZE]);
      const encoded = await encoder.run({ [encoder.inputNames[0]]: pixels });
      const hidden = encoded[encoder.outputNames[0]];
      const tokens = [START_TOKEN];
      // Greedy decoding. The decoder has no cache, so every step reads the whole sequence;
      // bubbles are short enough for that to stay fast.
      while (tokens.length < MAX_TOKENS) {
        const ids = new ort.Tensor("int64", BigInt64Array.from(tokens, BigInt), [1, tokens.length]);
        const output = await decoder.run({ input_ids: ids, encoder_hidden_states: hidden });
        const logits = output[decoder.outputNames[0]];
        const next = bestToken(logits.data, (tokens.length - 1) * logits.dims[2], logits.dims[2], banned(tokens));
        if (next === END_TOKEN) break;
        tokens.push(next);
      }
      return clean(tokens.slice(1).map((id) => vocab[id] ?? "").join(""));
    },
    async release() {
      await encoder.release();
      await decoder.release();
    },
  };
}

// Greyscale, squashed to 224×224 (averaging the source pixels under each output pixel) and
// normalised to -1…1, as the original's image processor does.
function toTensor({ data, width }, box) {
  const plane = SIZE * SIZE;
  const tensor = new Float32Array(3 * plane);
  const stepX = box.width / SIZE;
  const stepY = box.height / SIZE;
  for (let y = 0; y < SIZE; y++) {
    const y0 = Math.floor(box.y + y * stepY);
    const y1 = Math.max(y0 + 1, Math.floor(box.y + (y + 1) * stepY));
    for (let x = 0; x < SIZE; x++) {
      const x0 = Math.floor(box.x + x * stepX);
      const x1 = Math.max(x0 + 1, Math.floor(box.x + (x + 1) * stepX));
      let sum = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * width + sx) * 4;
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
      }
      const value = (sum / ((y1 - y0) * (x1 - x0)) / 255 - 0.5) / 0.5;
      tensor[y * SIZE + x] = value;
      tensor[plane + y * SIZE + x] = value;
      tensor[2 * plane + y * SIZE + x] = value;
    }
  }
  return tensor;
}

// Tokens that would repeat a three-token sequence already in `tokens`.
function banned(tokens) {
  const result = new Set();
  const prefix = tokens.slice(-(NO_REPEAT - 1)).join(",");
  for (let i = 0; i + NO_REPEAT <= tokens.length; i++) {
    if (tokens.slice(i, i + NO_REPEAT - 1).join(",") === prefix) result.add(tokens[i + NO_REPEAT - 1]);
  }
  return result;
}

function bestToken(logits, offset, count, skip) {
  let best = -1;
  for (let k = 0; k < count; k++) {
    if (skip.has(k)) continue;
    if (best < 0 || logits[offset + k] > logits[offset + best]) best = k;
  }
  return best;
}

// Drops special tokens and spaces, and returns "" for blocks with nothing but dots (bits of
// furigana or drawing read as ellipses).
function clean(text) {
  const result = text.replace(/\[[A-Z]+\]|<unused\d+>/g, "").replace(/\s/g, "").replace(/…/g, "...");
  return /^[.・…!?！？]*$/.test(result) ? "" : result;
}
