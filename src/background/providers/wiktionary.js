import { fetchJson, stripHtml } from "./http.js";
import { stripParticle, verbCandidates } from "../korean.js";

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
      // An inflected form ("courait") or alternative spelling ("Photographie") only says what it
      // is a form of; the meanings are on the linked word's page, so show those instead.
      if (result.definitions.every((def) => def.formOf)) {
        const linked = result.base?.word ?? result.definitions[0].formOf;
        const base = parse(await fetchPage(this.id, linked, ctx), src);
        if (base.definitions.length) return { ...base, base: result.base, examples: [...base.examples, ...result.examples] };
      }
      return result;
    }
    if (src === "ko") {
      for (const { word, formOf } of koreanBaseForms(text)) {
        const result = parse(await fetchPage(this.id, word, ctx), src);
        if (result.definitions.length) return { ...result, base: { word, formOf } };
      }
    }
    return { definitions: [], examples: [], base: null };
  },
};

// Wiktionary only has dictionary forms: the noun without its particle (학교에 → 학교), the verb
// without its ending (갔어요 → 가다). Each candidate is one request, so only the likeliest are tried.
const MAX_VERB_CANDIDATES = 4;

function koreanBaseForms(text) {
  const noun = stripParticle(text);
  return [
    ...(noun ? [{ word: noun.word, formOf: `with the particle ${noun.particle}` }] : []),
    ...verbCandidates(text)
      .slice(0, MAX_VERB_CANDIDATES)
      .map((word) => ({ word, formOf: `conjugated form of ${word}` })),
  ];
}

function fetchPage(id, word, ctx) {
  const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`;
  return fetchJson(id, url, { headers: { "Api-User-Agent": "LanguageCompanion (Firefox extension)" } }, ctx);
}

// Wiktionary marks inflected forms as "<span class="form-of-definition">… of <span
// class="form-of-definition-link"><a title="courir">"; the link's title is the base word's page.
const FORM_OF_LINK = /class="form-of-definition-link"[^>]*>(?:<[^>]+>)*?<a [^>]*title="([^"]+)"/;

// base: { word, formOf } for an inflected form, e.g. { word: "courir", formOf: "third-person … of courir" }.
// Another spelling of the same word is not one: a romanization, or "alternative form of こんにち" on 今日.
export function parse(data, src) {
  const definitions = [];
  const examples = [];
  let base = null;
  for (const entry of data?.[src] ?? []) {
    // "Rōmaji transcription of いしん" is not an inflection.
    const romanization = /romanization/i.test(entry.partOfSpeech ?? "");
    for (const def of entry.definitions ?? []) {
      const text = stripHtml(def.definition);
      const linked = stripHtml(FORM_OF_LINK.exec(def.definition ?? "")?.[1]);
      const alternativeForm = /^alternative (?:form|spelling) of\b/i.test(text);
      const followWord = romanization ? null : linked;
      const baseWord = alternativeForm ? null : followWord;
      base ??= baseWord ? { word: baseWord, formOf: text } : null;
      if (text) definitions.push({ pos: entry.partOfSpeech ?? "", text, ...(followWord ? { formOf: followWord } : {}) });
      for (const example of def.parsedExamples ?? []) {
        const sentence = stripHtml(example.example);
        if (sentence) examples.push({ text: sentence, translation: stripHtml(example.translation), source: "Wiktionary" });
      }
    }
  }
  return { definitions, examples, base };
}
