// How common a word is, from the bundled lists in data/frequency (see ATTRIBUTION.md there).
// Japanese has no list; Jisho's JLPT level and "common" flag are used instead (providers/jisho.js).

export const FREQUENCY_LANGS = ["en", "ko"];
const BANDS = [1000, 2000, 5000, 10000, 20000];
// Korean lists hold inflected words (먹었다) and there is no source for base forms, so a word
// missing from the list is not necessarily rare.
const NO_RARE = new Set(["ko"]);

async function loadList(lang) {
  const response = await fetch(browser.runtime.getURL(`data/frequency/${lang}.txt`));
  return response.text();
}

// `load(lang)` returns a list's text; tests pass their own.
export function createFrequency(load = loadList) {
  const lists = new Map();

  function list(lang) {
    if (!lists.has(lang)) {
      const ranks = load(lang).then((text) => new Map(text.split("\n").filter(Boolean).map((word, i) => [word, i + 1])));
      // A failed load is retried on the next lookup.
      ranks.catch(() => lists.delete(lang));
      lists.set(lang, ranks);
    }
    return lists.get(lang);
  }

  return {
    // 1 for the most common word, Infinity if the word is not in the list, null if unknown.
    async rank(lang, word) {
      if (!FREQUENCY_LANGS.includes(lang)) return null;
      return (await list(lang)).get(word.toLowerCase()) ?? (NO_RARE.has(lang) ? null : Infinity);
    },
  };
}

// { label: "Top 2k", rank } for the card badge and the Anki tag.
export function frequencyLabel(rank) {
  if (rank == null) return null;
  const band = BANDS.find((size) => rank <= size);
  return { label: band ? `Top ${band / 1000}k` : "Rare", rank: Number.isFinite(rank) ? rank : null };
}
