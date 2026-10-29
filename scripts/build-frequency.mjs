// Builds data/frequency/<lang>.txt: the most common words per language, most frequent first,
// one per line. Source: FrequencyWords (OpenSubtitles 2018), CC BY-SA 4.0, see data/frequency/README.md.
// Japanese is left out: its list splits words into fragments, so Jisho's JLPT levels are used instead.
// Run with: node scripts/build-frequency.mjs
import { mkdir, writeFile } from "node:fs/promises";

const LANGS = ["en", "fr", "ko", "ru", "sq", "tr"];
const SIZE = 20000;
const SOURCE = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018";
const OUT = new URL("../data/frequency/", import.meta.url);

await mkdir(OUT, { recursive: true });
for (const lang of LANGS) {
  const response = await fetch(`${SOURCE}/${lang}/${lang}_50k.txt`);
  if (!response.ok) throw new Error(`${lang}: HTTP ${response.status}`);
  const words = new Set();
  for (const line of (await response.text()).split("\n")) {
    const word = line.split(" ")[0].trim().toLowerCase();
    // Skips numbers and leftover punctuation from the subtitles.
    if (/^[\p{L}\p{M}][\p{L}\p{M}'’-]*$/u.test(word)) words.add(word);
    if (words.size === SIZE) break;
  }
  await writeFile(new URL(`${lang}.txt`, OUT), [...words].join("\n") + "\n");
  console.log(`${lang}: ${words.size} words`);
}
