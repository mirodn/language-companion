import { fetchJson, ProviderError } from "./http.js";

// Free machine translation without an API key. An email address raises the daily quota.
export default {
  id: "mymemory",
  name: "MyMemory",
  kind: "translate",
  needsKey: false,

  supports: () => true,

  async lookup({ text, src, tgt }, settings, ctx) {
    const params = new URLSearchParams({ q: text, langpair: `${src}|${tgt}` });
    if (settings.myMemoryEmail) params.set("de", settings.myMemoryEmail);
    const data = await fetchJson(this.id, `https://api.mymemory.translated.net/get?${params}`, {}, ctx);
    return { translation: parse(data) };
  },
};

export function parse(data) {
  if (!data || Number(data.responseStatus) !== 200) {
    throw new ProviderError("mymemory", data?.responseDetails || "translation failed");
  }
  if (data.quotaFinished) throw new ProviderError("mymemory", "daily quota reached");
  // A match below 1 is a fuzzy translation-memory hit for a different text, e.g. "A. Dwelling
  // space" for "dwelling space". The machine translation of the exact text is better then.
  if (Number(data.responseData?.match) < 1) {
    const machine = data.matches?.find((m) => m["created-by"] === "MT!");
    if (machine?.translation) return machine.translation;
  }
  return data.responseData?.translatedText ?? "";
}
