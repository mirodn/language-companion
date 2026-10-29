import { fetchJson } from "./http.js";

// jisho.org: Japanese-English dictionary with readings, used for furigana.
export default {
  id: "jisho",
  name: "Jisho (Japanese)",
  kind: "dictionary",
  needsKey: false,

  supports: (src) => src === "ja",

  async lookup({ text }, settings, ctx) {
    const url = `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(text)}`;
    return parse(await fetchJson(this.id, url, {}, ctx), text);
  },
};

// Only an entry for exactly this word counts; a related word would give a wrong reading.
export function parse(data, text) {
  for (const entry of data?.data ?? []) {
    const form = (entry.japanese ?? []).find((j) => j.word === text || (!j.word && j.reading === text));
    if (!form) continue;
    return {
      // Words written in kana need no reading.
      reading: form.word ? (form.reading ?? "") : "",
      definitions: (entry.senses ?? [])
        .filter((sense) => sense.english_definitions?.length)
        .map((sense) => ({ pos: sense.parts_of_speech?.[0] ?? "", text: sense.english_definitions.join("; ") })),
    };
  }
  return { reading: "", definitions: [] };
}
