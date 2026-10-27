import { fetchJson, stripHtml } from "./http.js";

// English Wiktionary definitions for words in (almost) any language.
// Definitions are written in English regardless of the word's language.
export default {
  id: "wiktionary",
  name: "Wiktionary",
  kind: "dictionary",
  needsKey: false,

  supports: () => true,

  async lookup({ text, src }, settings, ctx) {
    const candidates = [...new Set([text, text.toLowerCase()])];
    for (const word of candidates) {
      const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`;
      const data = await fetchJson(this.id, url, { headers: { "Api-User-Agent": "LanguageCompanion (Firefox extension)" } }, ctx);
      const result = parse(data, src);
      if (result.definitions.length) return result;
    }
    return { definitions: [], examples: [] };
  },
};

export function parse(data, src) {
  const definitions = [];
  const examples = [];
  for (const entry of data?.[src] ?? []) {
    for (const def of entry.definitions ?? []) {
      const text = stripHtml(def.definition);
      if (text) definitions.push({ pos: entry.partOfSpeech ?? "", text });
      for (const example of def.parsedExamples ?? []) {
        const sentence = stripHtml(example.example);
        if (sentence) examples.push({ text: sentence, translation: stripHtml(example.translation), source: "Wiktionary" });
      }
    }
  }
  return { definitions, examples };
}
