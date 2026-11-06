// Reads text in images (manga, webtoons) for src/content/image-text.js: captures the visible tab,
// finds the text lines with PaddleOCR (src/ocr/paddle.js) and reads speech bubbles on request:
// Japanese with manga-ocr (src/ocr/manga-ocr.js), Korean with PaddleOCR.
// Everything runs locally; only the models are downloaded once from Hugging Face.

import { createOcr } from "../ocr/paddle.js";
import { createMangaOcr } from "../ocr/manga-ocr.js";

// Pinned revisions, so the models can't change underneath the extension.
const PPOCR = "https://huggingface.co/nakamura196/ppocrv5-mobile-web-onnx/resolve/dc7e2271c00d961a4c0a38dcebe23beb735ba33e";
const KOREAN = "https://huggingface.co/monkt/paddleocr-onnx/resolve/7b02d0a30a07ba2b92ad1ff5a8941ae2c633de65/languages/korean";
const MANGA_OCR = "https://huggingface.co/onnx-community/manga-ocr-base-ONNX/resolve/f9023406bb2f6b17df67bc4a327c56ecd20611f0/onnx";
const MANGA_OCR_VOCAB = "https://huggingface.co/kha-white/manga-ocr-base/resolve/aa6573bd10b0d446cbf622e29c3e084914df9741/vocab.txt";
// Each file with its SHA-256, checked before it's cached or run.
const DETECT_MODEL = { url: `${PPOCR}/PP-OCRv5_mobile_det.onnx`, sha256: "6bdf743af375b13fbbeeb47a91a40063af5bfb7a7f197f6df8cb990dc827e5d6" };
// PaddleOCR line readers. Japanese uses manga-ocr instead.
const LINE_READERS = {
  ko: {
    model: { url: `${KOREAN}/rec.onnx`, sha256: "322f140154c820fcb83c3d24cfe42c9ec70dd1a1834163306a7338136e4f1eaa" },
    dict: { url: `${KOREAN}/dict.txt`, sha256: "a88071c68c01707489baa79ebe0405b7beb5cca229f4fc94cc3ef992328802d7" },
    parse: (text) => text.replace(/\n$/, "").split("\n"),
  },
};
const MANGA_OCR_FILES = {
  encoder: { url: `${MANGA_OCR}/encoder_model_quantized.onnx`, sha256: "ddd1af56963093795705fa38da6ce7e6567d1658e7c7359db7e13fcd37dbf279" },
  decoder: { url: `${MANGA_OCR}/decoder_model_quantized.onnx`, sha256: "2e7177d2b0a59f1c612b694ed70c13971bee765cc2b2bc7bc9376e4753652f27" },
  vocab: { url: MANGA_OCR_VOCAB, sha256: "344fbb6b8bf18c57839e924e2c9365434697e0227fac00b88bb4899b78aa594d" },
};
// v2: files are verified since 0.5; older, unverified downloads are dropped.
const MODEL_CACHE = "ocr-models-v2";
const LANGS = ["ja", "ko"];
const MAX_EXCLUDE = 10;
const MAX_LINES_PER_READ = 64;

// Screenshots are scaled down to this longest side for finding text; bubbles are read at full size.
const DETECT_SIZE = 1280;
// Room around a bubble's lines for manga-ocr, as a share of the bubble's smaller side.
const BUBBLE_MARGIN = 0.08;
// A capture this similar to the previous one (mean difference of a small greyscale thumbnail,
// 0–255) shows the same page, so the previous lines are still valid.
const SAME_PAGE = 2;
const THUMB_SIZE = 32;

let ortModule = null;
const engines = new Map();
// The last capture per tab, kept so bubbles can be read after they were found.
const captures = new Map();
let nextCaptureId = 1;
// The models run one request at a time.
let busy = Promise.resolve();

function serial(task) {
  const run = busy.then(task, task);
  busy = run.catch(() => {});
  return run;
}

// Downloads from before 0.5, which weren't verified.
export function dropOldModels() {
  return caches.delete("ocr-models-v1");
}

export function hasPermission() {
  return browser.permissions.contains({ origins: ["<all_urls>"] });
}

// Downloads in progress ({ loaded, total, done } by URL) and the tabs waiting for them, which
// get progress messages for the note in their corner (content/image-text.js).
const downloads = new Map();
const waitingTabs = new Set();
const PROGRESS_INTERVAL_MS = 250;
let lastReport = 0;

function reportProgress(force = false) {
  const now = Date.now();
  if (!force && now - lastReport < PROGRESS_INTERVAL_MS) return;
  lastReport = now;
  let loaded = 0;
  let total = 0;
  for (const item of downloads.values()) {
    loaded += item.loaded;
    total += item.total;
  }
  for (const tabId of waitingTabs) {
    browser.tabs.sendMessage(tabId, { type: globalThis.LC.MSG.OCR_PROGRESS, loaded, total }).catch(() => {});
  }
  if ([...downloads.values()].every((item) => item.done)) downloads.clear();
}

async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function download({ url, sha256: expected }) {
  const cache = await caches.open(MODEL_CACHE);
  const cached = await cache.match(url);
  if (cached) return new Uint8Array(await cached.arrayBuffer());
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't download the text recognition models (HTTP ${response.status}).`);
  const progress = { loaded: 0, total: Number(response.headers.get("content-length")) || 0, done: false };
  downloads.set(url, progress);
  try {
    const chunks = [];
    const reader = response.body.getReader();
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      chunks.push(chunk.value);
      progress.loaded += chunk.value.length;
      reportProgress();
    }
    const bytes = new Uint8Array(progress.loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if ((await sha256(bytes)) !== expected) throw new Error("The downloaded text recognition model is damaged. Try again.");
    await cache.put(url, new Response(bytes));
    return bytes;
  } finally {
    Object.assign(progress, { done: true, total: progress.total || progress.loaded, loaded: progress.total || progress.loaded });
    reportProgress(true);
  }
}

async function ort() {
  ortModule ??= await import("../vendor/onnxruntime-web/ort.wasm.min.mjs");
  // Extension pages can't be cross-origin isolated in Firefox, so WebAssembly gets one thread.
  ortModule.env.wasm.numThreads = 1;
  return ortModule;
}

// Loads a model set once; a failed download is retried on the next request.
function engine(name, load) {
  if (!engines.has(name)) {
    const loading = load();
    loading.catch(() => engines.delete(name));
    engines.set(name, loading);
  }
  return engines.get(name);
}

// Japanese only needs PaddleOCR to find text; Korean also reads lines with it.
function paddle(lang) {
  const reader = LINE_READERS[lang];
  return engine(reader ? `paddle-${lang}` : "paddle", async () => {
    if (!reader) return createOcr(await ort(), { detModel: await download(DETECT_MODEL) });
    const [detModel, recModel, dict] = await Promise.all([download(DETECT_MODEL), download(reader.model), download(reader.dict)]);
    return createOcr(await ort(), { detModel, recModel, dict: reader.parse(new TextDecoder().decode(dict)) });
  });
}

function mangaOcr() {
  return engine("manga-ocr", async () => {
    const [encoderModel, decoderModel, vocab] = await Promise.all([
      download(MANGA_OCR_FILES.encoder),
      download(MANGA_OCR_FILES.decoder),
      download(MANGA_OCR_FILES.vocab),
    ]);
    return createMangaOcr(await ort(), { encoderModel, decoderModel, vocab: new TextDecoder().decode(vocab).split("\n") });
  });
}

async function decode(dataUrl) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
  const small = new OffscreenCanvas(THUMB_SIZE, THUMB_SIZE).getContext("2d", { willReadFrequently: true });
  small.drawImage(bitmap, 0, 0, THUMB_SIZE, THUMB_SIZE);
  const pixels = small.getImageData(0, 0, THUMB_SIZE, THUMB_SIZE).data;
  const thumb = new Uint8Array(THUMB_SIZE * THUMB_SIZE);
  for (let i = 0; i < thumb.length; i++) thumb[i] = (pixels[i * 4] + pixels[i * 4 + 1] + pixels[i * 4 + 2]) / 3;
  return { image, thumb };
}

function samePage(a, b) {
  if (!a || !b) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference += Math.abs(a[i] - b[i]);
  return difference / a.length < SAME_PAGE;
}

// Captures the visible part of the sender's tab and finds the text lines in it.
// lang: "ja" or "ko", which decides how bubbles are read.
// viewport: the page's CSS size, to convert screenshot pixels to page coordinates.
// exclude: viewport rects of the extension's own UI (the open card), which aren't page text.
// Returns { captureId, unchanged, lines: [{ id, box, vertical }] } with boxes in viewport pixels.
export async function scan({ lang, viewport, exclude = [] }, sender) {
  if (!LANGS.includes(lang)) throw new Error("Unsupported language.");
  if (!(viewport?.width > 0 && viewport?.height > 0 && Number.isFinite(viewport.width) && Number.isFinite(viewport.height))) {
    throw new Error("Invalid viewport.");
  }
  if (!Array.isArray(exclude) || exclude.length > MAX_EXCLUDE) throw new Error("Invalid exclude list.");
  if (!(await hasPermission())) throw new Error("permission");
  // captureVisibleTab shows whatever tab is in front, so only the visible top frame may scan:
  // a tab in the background would otherwise read the tab the user is looking at.
  if (!sender.tab || sender.frameId !== 0) throw new Error("not-visible");
  const tab = await browser.tabs.get(sender.tab.id);
  if (!tab.active) throw new Error("not-visible");
  const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  // The user may have switched tabs while the screenshot was taken.
  if (!(await browser.tabs.get(tab.id)).active) throw new Error("not-visible");
  const { image, thumb } = await decode(dataUrl);
  const previous = captures.get(tab.id);
  if (previous?.lang === lang && samePage(previous.thumb, thumb)) {
    return { captureId: previous.id, unchanged: true, lines: previous.lines };
  }
  const scale = image.width / viewport.width;
  // The first time, this downloads the models, with progress shown in the tab. Japanese bubbles
  // are read with manga-ocr, which is loaded now too, so the first bubble doesn't wait for it.
  waitingTabs.add(tab.id);
  let detector;
  try {
    [detector] = await Promise.all([paddle(lang), lang === "ja" && mangaOcr()]);
  } finally {
    waitingTabs.delete(tab.id);
  }
  const found = await serial(() => detector.detect(image, { maxSide: DETECT_SIZE }));
  const lines = [];
  for (const line of found) {
    const box = { x: line.box.x / scale, y: line.box.y / scale, width: line.box.width / scale, height: line.box.height / scale };
    if (exclude.some((rect) => intersects(box, rect))) continue;
    lines.push({ id: lines.length, box, vertical: line.vertical, pixels: line.box });
  }
  const capture = { id: nextCaptureId++, lang, image, thumb, lines: lines.map(({ pixels, ...line }) => line), found: lines };
  captures.set(tab.id, capture);
  return { captureId: capture.id, unchanged: false, lines: capture.lines };
}

// Reads one speech bubble, given as the ids of its lines from scan(). Returns { text }, which is
// "" when the lines turn out not to be text.
export async function read({ captureId, ids }, sender) {
  if (!Array.isArray(ids) || ids.length > MAX_LINES_PER_READ || !ids.every(Number.isInteger)) throw new Error("Invalid lines.");
  const capture = captures.get(sender.tab?.id);
  // The background may have been unloaded since, or the page changed: the caller scans again.
  if (capture?.id !== captureId) throw new Error("expired");
  const lines = ids.map((id) => capture.found.find((line) => line.id === id)).filter(Boolean);
  if (!lines.length) return { text: "" };
  if (capture.lang === "ja") {
    const box = bubbleBox(lines.map((line) => line.pixels), capture.image);
    return { text: await serial(async () => (await mangaOcr()).read(capture.image, box)) };
  }
  const read = await serial(async () => (await paddle(capture.lang)).read(
    capture.image,
    lines.map((line) => ({ box: line.pixels, vertical: line.vertical })),
  ));
  // Lines come in the caller's reading order; Korean separates them with spaces.
  return { text: read.map((line) => line.text).join(capture.lang === "ko" ? " " : "") };
}

export function forgetTab(tabId) {
  captures.delete(tabId);
}

// The area around all of a bubble's lines, with a margin, in image pixels.
function bubbleBox(boxes, image) {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  const margin = Math.min(right - left, bottom - top) * BUBBLE_MARGIN;
  const x = Math.max(0, Math.floor(left - margin));
  const y = Math.max(0, Math.floor(top - margin));
  return {
    x,
    y,
    width: Math.min(image.width, Math.ceil(right + margin)) - x,
    height: Math.min(image.height, Math.ceil(bottom + margin)) - y,
  };
}

function intersects(a, b) {
  return a.x < b.right && a.x + a.width > b.left && a.y < b.bottom && a.y + a.height > b.top;
}
