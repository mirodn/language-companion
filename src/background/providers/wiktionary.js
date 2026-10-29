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
      const result = parse(await fetchPage(this.id, word, ctx), src);
      if (!result.definitions.length) continue;
      // An inflected form ("courait") only says what it is a form of; the meanings are on the
      // base word's page, so show those instead.
      if (result.base && result.definitions.every((def) => def.formOf)) {
        const base = parse(await fetchPage(this.id, result.base.word, ctx), src);
        if (base.definitions.length) return { ...base, base: result.base, examples: [...base.examples, ...result.examples] };
      }
      return result;
    }
    return { definitions: [], examples: [], base: null };
  },
};

function fetchPage(id, word, ctx) {
  const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`;
  return fetchJson(id, url, { headers: { "Api-User-Agent": "LanguageCompanion (Firefox extension)" } }, ctx);
}

// Wiktionary marks inflected forms as "<span class="form-of-definition">… of <span
// class="form-of-definition-link"><a title="courir">"; the link's title is the base word's page.
const FORM_OF_LINK = /class="form-of-definition-link"[^>]*>(?:<[^>]+>)*?<a [^>]*title="([^"]+)"/;

// base: { word, formOf } for an inflected form, e.g. { word: "courir", formOf: "third-person … of courir" }.
export function parse(data, src) {
  const definitions = [];
  const examples = [];
  let base = null;
  for (const entry of data?.[src] ?? []) {
    // "Rōmaji transcription of いしん" is not an inflection.
    const romanization = /romanization/i.test(entry.partOfSpeech ?? "");
    for (const def of entry.definitions ?? []) {
      const text = stripHtml(def.definition);
      const baseWord = romanization ? null : stripHtml(FORM_OF_LINK.exec(def.definition ?? "")?.[1]);
      base ??= baseWord ? { word: baseWord, formOf: text } : null;
      if (text) definitions.push({ pos: entry.partOfSpeech ?? "", text, ...(baseWord ? { formOf: baseWord } : {}) });
      for (const example of def.parsedExamples ?? []) {
        const sentence = stripHtml(example.example);
        if (sentence) examples.push({ text: sentence, translation: stripHtml(example.translation), source: "Wiktionary" });
      }
    }
  }
  return { definitions, examples, base };
}
