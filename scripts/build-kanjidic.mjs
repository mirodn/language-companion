// Builds data/kanjidic/kanjidic.txt from KANJIDIC2 (CC BY-SA 4.0, see data/kanjidic/ATTRIBUTION.md):
// the English meanings and readings of each kanji, for the kanji breakdown on the card.
// Line format: kanji \t meanings separated by "; " \t on'yomi (katakana) \t kun'yomi (hiragana).
// Run with: node scripts/build-kanjidic.mjs
import { writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const SOURCE = "http://www.edrdg.org/kanjidic/kanjidic2.xml.gz";
const OUT = new URL("../data/kanjidic/kanjidic.txt", import.meta.url);
const MAX_MEANINGS = 3;
const MAX_READINGS = 3;

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const xml = gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8");

const all = (pattern, text) => [...text.matchAll(pattern)].map((match) => match[1]);
const lines = [];
for (const [character] of xml.matchAll(/<character>[\s\S]*?<\/character>/g)) {
  const literal = character.match(/<literal>(.+?)<\/literal>/)[1];
  // English meanings have no m_lang attribute.
  const meanings = all(/<meaning>([^<]+)<\/meaning>/g, character).slice(0, MAX_MEANINGS);
  if (!meanings.length) continue;
  const on = all(/<reading r_type="ja_on">([^<]+)<\/reading>/g, character).slice(0, MAX_READINGS);
  const kun = all(/<reading r_type="ja_kun">([^<]+)<\/reading>/g, character).slice(0, MAX_READINGS);
  lines.push([literal, meanings.join("; "), on.join("、"), kun.join("、")].join("\t"));
}
await writeFile(OUT, lines.join("\n") + "\n");
console.log(`${lines.length} kanji`);
