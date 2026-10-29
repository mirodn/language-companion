// Builds data/cedict/<n>.txt from CC-CEDICT (CC BY-SA 4.0, see data/cedict/ATTRIBUTION.md).
// Entries are split into SHARDS files by their first character, so a lookup loads one small file.
// An entry is stored under both its simplified and its traditional spelling.
// Line format: simplified \t traditional \t pinyin with tone marks \t definitions separated by "/".
// Run with: node scripts/build-cedict.mjs
import { mkdir, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const SOURCE = "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz";
const OUT = new URL("../data/cedict/", import.meta.url);
// Keep in sync with src/background/providers/cedict.js.
const SHARDS = 64;

const TONES = { a: "āáǎà", e: "ēéěè", i: "īíǐì", o: "ōóǒò", u: "ūúǔù", ü: "ǖǘǚǜ" };

// "xue2" -> "xué", "lu:4" -> "lǜ", "le5" -> "le"
function syllable(numbered) {
  const match = numbered.match(/^([a-zü:]+)([1-5])$/i);
  if (!match) return numbered.replace(/u:/g, "ü");
  const [, letters, tone] = match;
  const base = letters.replace(/u:/g, "ü").replace(/U:/g, "Ü");
  if (tone === "5") return base;
  const lower = base.toLowerCase();
  // a or e takes the mark, "ou" marks the o, otherwise the last vowel.
  let index = lower.search(/[ae]/);
  if (index < 0) index = lower.indexOf("ou");
  if (index < 0) index = Math.max(...[..."iouü"].map((v) => lower.lastIndexOf(v)));
  if (index < 0) return base;
  const vowel = lower[index];
  const marked = TONES[vowel][Number(tone) - 1];
  const char = base[index] === vowel ? marked : marked.toUpperCase();
  return base.slice(0, index) + char + base.slice(index + 1);
}

const pinyin = (numbered) => numbered.split(" ").map(syllable).join(" ");

// "CL:個|个[ge4],位[wei4]" -> "Classifier: 个, 位"; "得[de2]" -> "得 (dé)"; "學|学[xue2]" -> "学 (xué)"
function definition(text) {
  if (text.startsWith("CL:")) {
    const words = text.slice(3).split(",").map((item) => item.replace(/\[[^\]]*\]/, "").split("|").at(-1));
    return `Classifier: ${words.join(", ")}`;
  }
  return text.replace(/(?:[^\s|[\]]+\|)?([^\s|[\]]+)\[([^\]]+)\]/g, (_, word, reading) => `${word} (${pinyin(reading)})`);
}

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const text = gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8");

const shards = Array.from({ length: SHARDS }, () => []);
const shardOf = (word) => word.codePointAt(0) % SHARDS;
let count = 0;
for (const line of text.split("\n")) {
  const match = line.match(/^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/\s*$/);
  if (!match) continue;
  const [, traditional, simplified, reading, defs] = match;
  const entry = [simplified, traditional, pinyin(reading), defs.split("/").map(definition).join("/")].join("\t");
  shards[shardOf(simplified)].push(entry);
  if (shardOf(traditional) !== shardOf(simplified)) shards[shardOf(traditional)].push(entry);
  count += 1;
}

await mkdir(OUT, { recursive: true });
await Promise.all(shards.map((lines, i) => writeFile(new URL(`${i}.txt`, OUT), lines.join("\n") + "\n")));
console.log(`${count} entries in ${SHARDS} files`);
