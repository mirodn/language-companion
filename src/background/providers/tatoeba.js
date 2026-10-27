import "../../shared/languages.js";
import { fetchJson } from "./http.js";

const { languages } = globalThis.LC;

// Example sentences with human translations from tatoeba.org. The API can be slow,
// so it gets a longer timeout; the card renders without it if it does not answer.
export default {
  id: "tatoeba",
  name: "Tatoeba",
  kind: "examples",
  needsKey: false,

  supports: (src, tgt) => Boolean(languages.get(src)?.tatoeba && languages.get(tgt)?.tatoeba),

  async lookup({ text, src, tgt }, settings, ctx) {
    const params = new URLSearchParams({
      lang: languages.get(src).tatoeba,
      q: text,
      "trans:lang": languages.get(tgt).tatoeba,
      showtrans: "matching",
      sort: "relevance",
      limit: String(settings.maxExamples ?? 3),
    });
    const url = `https://api.tatoeba.org/unstable/sentences?${params}`;
    return { examples: parse(await fetchJson(this.id, url, {}, { timeoutMs: 12000, ...ctx })) };
  },
};

export function parse(data) {
  return (data?.data ?? []).map((sentence) => {
    const translations = sentence.translations ?? [];
    const best = translations.find((t) => t.is_direct) ?? translations[0];
    return { text: sentence.text, translation: best?.text ?? "", source: "Tatoeba" };
  });
}
