import { fetchJson } from "./http.js";

// dictionaryapi.dev: English only, but provides IPA and pronunciation audio.
export default {
  id: "freedictionary",
  name: "Free Dictionary (English)",
  kind: "dictionary",
  needsKey: false,

  supports: (src) => src === "en",

  async lookup({ text }, settings, ctx) {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(text.toLowerCase())}`;
    return parse(await fetchJson(this.id, url, {}, ctx));
  },
};

export function parse(data) {
  const entries = Array.isArray(data) ? data : [];
  const phonetics = entries.flatMap((entry) => entry.phonetics ?? []);
  const definitions = [];
  const examples = [];
  for (const meaning of entries.flatMap((entry) => entry.meanings ?? [])) {
    for (const def of meaning.definitions ?? []) {
      if (def.definition) definitions.push({ pos: meaning.partOfSpeech ?? "", text: def.definition });
      if (def.example) examples.push({ text: def.example, translation: "", source: "Free Dictionary" });
    }
  }
  return {
    ipa: entries.find((entry) => entry.phonetic)?.phonetic ?? phonetics.find((p) => p.text)?.text ?? "",
    audioUrl: phonetics.find((p) => p.audio)?.audio ?? "",
    definitions,
    examples,
  };
}
