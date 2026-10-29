// CC-CEDICT, bundled in data/cedict (see ATTRIBUTION.md there): Chinese definitions and pinyin,
// for simplified and traditional spellings. Built by scripts/build-cedict.mjs.

// Keep in sync with scripts/build-cedict.mjs.
const SHARDS = 64;

async function loadShard(n) {
  const response = await fetch(browser.runtime.getURL(`data/cedict/${n}.txt`));
  return response.text();
}

export default {
  id: "cedict",
  name: "CC-CEDICT (Chinese)",
  kind: "dictionary",
  needsKey: false,

  supports: (src) => src === "zh",

  // `ctx.loadShard(n)` lets tests provide the data.
  async lookup({ text }, settings, ctx = {}) {
    const shard = await (ctx.loadShard ?? loadShard)(text.codePointAt(0) % SHARDS);
    return parse(shard, text);
  },
};

const ONLY_A_REFERENCE = /^((old|archaic|erhua|unofficial|Japanese) )*variant of |^used in |^see /;

// Entries for exactly this word, in either spelling. A character with several readings (行: háng,
// xíng) gets each reading as the "part of speech" of its definitions, which take turns between the
// readings so that each one is among the first definitions shown.
export function parse(shard, text) {
  const entries = shard
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([simplified, traditional]) => simplified === text || traditional === text);
  if (!entries.length) return { reading: "", definitions: [] };

  // Proper nouns (李 Lǐ, a surname) and common words (李 lǐ, plum) share a reading.
  const byReading = new Map();
  for (const [, , pinyin, defs] of entries) {
    const reading = pinyin.toLowerCase();
    byReading.set(reading, [...(byReading.get(reading) ?? []), ...defs.split("/")]);
  }
  // Readings that only point elsewhere (行 héng: "used in 道行") are dropped if there are others.
  for (const [reading, defs] of byReading) {
    if (byReading.size > 1 && defs.every((def) => ONLY_A_REFERENCE.test(def))) byReading.delete(reading);
  }
  const several = byReading.size > 1;
  const lists = [...byReading].map(([reading, defs]) => defs.map((def) => ({ pos: several ? reading : "", text: def })));
  const definitions = [];
  for (let i = 0; lists.some((list) => i < list.length); i++) {
    for (const list of lists) if (i < list.length) definitions.push(list[i]);
  }
  return { reading: [...byReading.keys()].join(" / "), definitions };
}
