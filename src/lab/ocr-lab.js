// OCR lab: measures how fast and how well the PaddleOCR models read manga, manhwa and manhua
// in this browser. Results can be copied as JSON to compare devices and settings.

import { createOcr } from "../ocr/paddle.js";

const HF = "https://huggingface.co";
const DETECT_MODEL = `${HF}/nakamura196/ppocrv5-mobile-web-onnx/resolve/main/PP-OCRv5_mobile_det.onnx`;
const READERS = {
  cjk: {
    model: `${HF}/nakamura196/ppocrv5-mobile-web-onnx/resolve/main/PP-OCRv5_mobile_rec.onnx`,
    dict: `${HF}/nakamura196/ppocrv5-mobile-web-onnx/resolve/main/PP-OCRv5_mobile_rec.dict.json`,
    parse: (text) => JSON.parse(text),
  },
  ko: {
    model: `${HF}/monkt/paddleocr-onnx/resolve/main/languages/korean/rec.onnx`,
    dict: `${HF}/monkt/paddleocr-onnx/resolve/main/languages/korean/dict.txt`,
    parse: (text) => text.replace(/\n$/, "").split("\n"),
  },
};
const MODEL_CACHE = "ocr-lab-models";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const environment = {};
const images = [];
const runs = [];
let ort = null;
let ocr = null;
let ocrConfig = null;
let queue = Promise.resolve();

for (const id of ["language", "backend", "threads", "max-side"]) {
  if (params.has(id)) $(id).value = params.get(id);
}

function settings() {
  return {
    language: $("language").value,
    backend: $("backend").value,
    threads: Number($("threads").value),
    maxSide: Number($("max-side").value),
  };
}

// ---- Environment ----

async function describeEnvironment() {
  environment.userAgent = navigator.userAgent;
  environment.cores = navigator.hardwareConcurrency;
  environment.crossOriginIsolated = self.crossOriginIsolated === true;
  environment.sharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
  environment.webgpu = "not available";
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      environment.webgpu = adapter ? describeAdapter(adapter) : "no adapter";
    } catch (error) {
      environment.webgpu = `error: ${error.message}`;
    }
  }
  try {
    ort = await import("../vendor/onnxruntime-web/ort.wasm.min.mjs");
    environment.runtime = `onnxruntime-web ${ort.env.versions?.web ?? "loaded"}`;
  } catch (error) {
    environment.runtime = "missing, start the page with npm run lab";
  }
  renderEnvironment();
}

function describeAdapter(adapter) {
  const info = adapter.info ?? {};
  return [info.vendor, info.architecture, info.description].filter(Boolean).join(" ") || "available";
}

function renderEnvironment() {
  const labels = {
    userAgent: "Browser",
    cores: "CPU cores",
    crossOriginIsolated: "Cross-origin isolated (needed for threads)",
    sharedArrayBuffer: "SharedArrayBuffer",
    webgpu: "WebGPU",
    runtime: "Runtime",
    threadsUsed: "Threads in use",
  };
  const list = $("environment");
  list.replaceChildren();
  for (const [key, label] of Object.entries(labels)) {
    if (!(key in environment)) continue;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = String(environment[key]);
    list.append(dt, dd);
  }
}

// ---- Models ----

async function download(url) {
  let cache = null;
  try {
    cache = await caches.open(MODEL_CACHE);
    const cached = await cache.match(url);
    if (cached) return { bytes: new Uint8Array(await cached.arrayBuffer()), cached: true };
  } catch {
    cache = null;  // no Cache API, for example in private windows
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  if (cache) await cache.put(url, response.clone());
  return { bytes: new Uint8Array(await response.arrayBuffer()), cached: false };
}

async function loadEngine() {
  if (!ort) return;
  const config = settings();
  if (ocrConfig && config.threads !== ocrConfig.threads) {
    // The thread count is fixed once WebAssembly has started, so apply it with a fresh page.
    for (const id of ["language", "backend", "threads", "max-side"]) params.set(id, $(id).value);
    location.search = params.toString();
    return;
  }
  const status = $("engine-status");
  $("load").disabled = true;
  try {
    if (ocr) await ocr.release();
    ocr = null;
    ort.env.wasm.numThreads = config.threads;
    const reader = READERS[config.language === "ko" ? "ko" : "cjk"];
    status.textContent = "Downloading models…";
    const started = performance.now();
    const [detect, read, dict] = await Promise.all([download(DETECT_MODEL), download(reader.model), download(reader.dict)]);
    const downloaded = performance.now();
    const megabytes = (detect.bytes.length + read.bytes.length + dict.bytes.length) / 1e6;
    status.textContent = "Starting…";
    ocr = await createOcr(ort, {
      detModel: detect.bytes,
      recModel: read.bytes,
      dict: reader.parse(new TextDecoder().decode(dict.bytes)),
      sessionOptions: { executionProviders: [config.backend] },
    });
    ocrConfig = config;
    environment.threadsUsed = ort.env.wasm.numThreads;
    renderEnvironment();
    const source = detect.cached && read.cached ? "from cache" : `downloaded in ${seconds(downloaded - started)}`;
    status.textContent = `Ready: ${megabytes.toFixed(1)} MB ${source}, started in ${seconds(performance.now() - downloaded)}.`;
    status.className = "success";
    for (const entry of images) enqueue(entry);
  } catch (error) {
    status.textContent = `Failed: ${error.message}`;
    status.className = "error";
    console.error(error);
  } finally {
    $("load").disabled = false;
  }
}

function engineChanged() {
  if (!ocr) return;
  $("engine-status").textContent = "Settings changed. Load the models again to rerun the images.";
  $("engine-status").className = "muted";
}

// ---- Images ----

async function addImage(name, blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0);
  const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height);
  const element = $("result-template").content.firstElementChild.cloneNode(true);
  element.querySelector(".name").textContent = name;
  element.querySelector(".timing").textContent = ocr ? "Waiting…" : "Load the models to read this image.";
  element.querySelector("textarea").addEventListener("input", () => score(entry));
  $("results").append(element);
  const entry = { name, bitmap, image: { data, width, height }, element, run: null };
  images.push(entry);
  if (ocr) enqueue(entry);
}

function enqueue(entry) {
  entry.element.querySelector(".timing").textContent = "Waiting…";
  queue = queue.then(() => readImage(entry)).catch((error) => {
    entry.element.querySelector(".timing").textContent = `Failed: ${error.message}`;
    console.error(error);
  });
}

async function readImage(entry) {
  const { maxSide } = ocrConfig;
  entry.element.querySelector(".timing").textContent = "Reading…";
  // Let the page paint before the first, slower run blocks it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const first = await ocr.recognize(entry.image, { maxSide });
  const repeat = await ocr.recognize(entry.image, { maxSide });
  const lines = inReadingOrder(repeat.lines);
  entry.run = { config: { ...ocrConfig }, first: first.timings, repeat: repeat.timings, lines, correct: null };
  runs.push(entry.run);
  entry.run.name = entry.name;
  entry.run.size = `${entry.image.width}×${entry.image.height}`;

  const { detect, read, total } = repeat.timings;
  entry.element.querySelector(".timing").textContent =
    `${entry.run.size} · first run ${ms(first.timings.total)} · repeat ${ms(total)} (finding text ${ms(detect)}, reading ${ms(read)}) · ${describeConfig(ocrConfig)}`;
  drawBoxes(entry);
  const list = entry.element.querySelector(".lines");
  list.replaceChildren(...lines.map((line) => {
    const item = document.createElement("li");
    item.textContent = `${line.text}  (${Math.round(line.score * 100)}%${line.vertical ? ", vertical" : ""})`;
    if (line.score < 0.8) item.className = "low";
    return item;
  }));
  score(entry);
}

// Vertical text (manga) reads in columns from right to left, horizontal text in rows from top.
function inReadingOrder(lines) {
  const vertical = lines.filter((line) => line.vertical).length > lines.length / 2;
  return [...lines].sort((a, b) => vertical
    ? (b.box.x + b.box.width) - (a.box.x + a.box.width)
    : a.box.y - b.box.y || a.box.x - b.box.x);
}

function drawBoxes(entry) {
  const canvas = entry.element.querySelector("canvas");
  const { bitmap } = entry;
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0);
  const width = Math.max(2, bitmap.width / 400);
  context.lineWidth = width;
  context.font = `${width * 8}px sans-serif`;
  entry.run.lines.forEach((line, i) => {
    const { x, y, width: w, height: h } = line.box;
    context.strokeStyle = line.vertical ? "#2f6fed" : "#c93a3a";
    context.strokeRect(x, y, w, h);
    context.fillStyle = context.strokeStyle;
    context.fillText(String(i + 1), x, Math.max(width * 8, y - width));
  });
}

// Share of the expected characters that were read, ignoring order and spaces.
function score(entry) {
  const output = entry.element.querySelector(".score");
  const expected = entry.element.querySelector("textarea").value.replace(/\s/g, "");
  if (!entry.run || !expected) {
    output.textContent = "";
    if (entry.run) entry.run.correct = null;
    renderSummary();
    return;
  }
  const found = new Map();
  for (const ch of entry.run.lines.map((line) => line.text).join("").replace(/\s/g, "")) {
    found.set(ch, (found.get(ch) ?? 0) + 1);
  }
  let hits = 0;
  for (const ch of expected) {
    if (found.get(ch)) {
      hits++;
      found.set(ch, found.get(ch) - 1);
    }
  }
  const extra = [...found.values()].reduce((sum, n) => sum + n, 0);
  entry.run.correct = hits / [...expected].length;
  output.textContent = `${percent(entry.run.correct)} of the expected characters read correctly, ${extra} extra characters.`;
  renderSummary();
}

function renderSummary() {
  $("summary").hidden = runs.length === 0;
  $("summary-rows").replaceChildren(...runs.map((run) => {
    const row = document.createElement("tr");
    const cells = [
      `${run.name} (${describeConfig(run.config)})`,
      run.size,
      ms(run.first.total),
      ms(run.repeat.total),
      String(run.lines.length),
      run.correct === null ? "–" : percent(run.correct),
    ];
    for (const text of cells) {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.append(cell);
    }
    return row;
  }));
}

async function copyResults() {
  const report = {
    environment,
    runs: runs.map((run) => ({
      name: run.name,
      size: run.size,
      config: run.config,
      first: round(run.first),
      repeat: round(run.repeat),
      correct: run.correct,
      lines: run.lines.map((line) => ({ text: line.text, score: Number(line.score.toFixed(3)), vertical: line.vertical })),
    })),
  };
  await navigator.clipboard.writeText(JSON.stringify(report, null, 1));
  $("copy").textContent = "Copied";
  setTimeout(() => { $("copy").textContent = "Copy results"; }, 1500);
}

// ---- Formatting ----

function describeConfig({ language, backend, threads, maxSide }) {
  return `${language}, ${backend}${backend === "wasm" ? ` ×${environment.threadsUsed ?? threads}` : ""}, ${maxSide} px`;
}

function ms(value) {
  return `${Math.round(value)} ms`;
}

function seconds(value) {
  return `${(value / 1000).toFixed(1)} s`;
}

function percent(value) {
  return `${Math.round(value * 1000) / 10}%`;
}

function round(timings) {
  return Object.fromEntries(Object.entries(timings).map(([key, value]) => [key, Math.round(value)]));
}

// ---- Wiring ----

$("load").addEventListener("click", loadEngine);
for (const id of ["language", "backend", "max-side"]) $(id).addEventListener("change", engineChanged);
$("threads").addEventListener("change", () => {
  if (ocr) loadEngine();
});
$("files").addEventListener("change", async (event) => {
  for (const file of event.target.files) await addImage(file.name, file);
  event.target.value = "";
});
$("add-url").addEventListener("click", async () => {
  const url = $("image-url").value.trim();
  if (!url) return;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await addImage(url.split("/").pop() || url, await response.blob());
    $("image-url").value = "";
  } catch (error) {
    $("engine-status").textContent = `Could not download the image (${error.message}). Try "Allow downloads from all sites".`;
    $("engine-status").className = "error";
  }
});
$("allow-sites").addEventListener("click", () => browser.permissions.request({ origins: ["*://*/*"] }));
$("copy").addEventListener("click", copyResults);

describeEnvironment();
