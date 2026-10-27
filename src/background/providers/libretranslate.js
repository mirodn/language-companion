import { fetchJson, ProviderError } from "./http.js";

// Self-hosted (or public) LibreTranslate instance. The URL is set in the options page,
// which also requests the host permission for it.
export default {
  id: "libretranslate",
  name: "LibreTranslate",
  kind: "translate",
  needsKey: false,

  supports: () => true,

  async lookup({ text, src, tgt }, settings, ctx) {
    if (!settings.libreUrl) throw new ProviderError(this.id, "no server URL set");
    const url = new URL("translate", settings.libreUrl.replace(/\/?$/, "/"));
    const body = { q: text, source: src, target: tgt, format: "text" };
    if (settings.libreKey) body.api_key = settings.libreKey;
    const data = await fetchJson(
      this.id,
      url.href,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      ctx,
    );
    if (data?.error) throw new ProviderError(this.id, data.error);
    return { translation: data?.translatedText ?? "" };
  },
};
