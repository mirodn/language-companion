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
  return data.responseData?.translatedText ?? "";
}
