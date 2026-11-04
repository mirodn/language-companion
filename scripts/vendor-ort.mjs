// Copies the onnxruntime-web files the OCR needs from node_modules into src/vendor.
// The runtime is code, so it has to ship inside the extension; only the models are downloaded.
// Runs automatically before npm start, build, lint and lab; the copy is not committed.

import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules/onnxruntime-web/dist");
const to = join(root, "src/vendor/onnxruntime-web");

// The WebAssembly (CPU) build only: half the size of the one that can also use the GPU.
const files = ["ort.wasm.min.mjs", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"];

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
for (const file of files) copyFileSync(join(from, file), join(to, file));
console.log(`Copied ${files.length} files to ${to}`);
