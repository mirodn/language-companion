// KANJIDIC2, bundled in data/kanjidic (see ATTRIBUTION.md there): the meaning of each kanji in a
// Japanese word (学校 → 学 study, 校 school). Built by scripts/build-kanjidic.mjs.

const KANJI = /[㐀-䶿一-鿿々]/g;

let entries = null;

async function loadEntries() {
  const response = await fetch(browser.runtime.getURL("data/kanjidic/kanjidic.txt"));
  return parseFile(await response.text());
}

export function parseFile(text) {
  return new Map(
    text
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [character, meanings, on, kun] = line.split("\t");
        return [character, { character, meanings, on: on ?? "", kun: kun ?? "" }];
      }),
  );
}

export default {
  id: "kanjidic",
  name: "KANJIDIC (Japanese)",
  kind: "dictionary",
  needsKey: false,

  supports: (src) => src === "ja",

  // `ctx.kanjidic` (a Map from parseFile) lets tests provide the data.
  async lookup({ text }, settings, ctx = {}) {
    const map = ctx.kanjidic ?? (entries ??= loadEntries().catch((error) => ((entries = null), Promise.reject(error))));
    return { kanji: breakdown(await map, text) };
  },
};

// Each distinct kanji of the word that has an entry, in order.
export function breakdown(map, text) {
  return [...new Set(text.match(KANJI) ?? [])].map((character) => map.get(character)).filter(Boolean);
}
