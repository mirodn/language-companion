import "../../shared/languages.js";
import { fetchJson, ProviderError } from "./http.js";

const { languages } = globalThis.LC;

// DeepL target codes that need a regional variant.
const TARGET_VARIANTS = { EN: "EN-US", PT: "PT-BR" };

export default {
  id: "deepl",
  name: "DeepL",
  kind: "translate",
  needsKey: true,

  supports: (src, tgt) => Boolean(languages.get(src)?.deepl && languages.get(tgt)?.deepl),

  async lookup({ text, src, tgt }, settings, ctx) {
    if (!settings.deeplKey) throw new ProviderError(this.id, "no API key set");
    // Free-tier keys end with ":fx" and use a different host.
    const host = settings.deeplKey.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
    const target = languages.get(tgt).deepl;
    const data = await fetchJson(
      this.id,
      `https://${host}/v2/translate`,
      {
        method: "POST",
        headers: {
          Authorization: `DeepL-Auth-Key ${settings.deeplKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: [text],
          source_lang: languages.get(src).deepl,
          target_lang: TARGET_VARIANTS[target] ?? target,
        }),
      },
      ctx,
    );
    return { translation: data?.translations?.[0]?.text ?? "" };
  },
};
