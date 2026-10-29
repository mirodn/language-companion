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

const KANA_ONLY = /^[\u3040-\u309f]*$/;

const definitionsOf = (entry) =>
  (entry.senses ?? [])
    .filter((sense) => sense.english_definitions?.length)
    .map((sense) => ({ pos: sense.parts_of_speech?.[0] ?? "", text: sense.english_definitions.join("; ") }));

// Japanese has no bundled frequency list, so the JLPT level (N5 easiest) or Jisho's "common" flag is used.
function frequencyOf(entry) {
  const levels = (entry.jlpt ?? []).map((tag) => Number(tag.match(/n(\d)/i)?.[1])).filter(Boolean);
  if (levels.length) return { label: `JLPT N${Math.max(...levels)}`, rank: null };
  return entry.is_common ? { label: "Common", rank: null } : null;
}

// Jisho turns conjugated verbs and adjectives into their dictionary form (食べた -> 食べる) and
// lists that first. It only counts if the word is that form's stem plus kana (食べ + た).
function deinflected(entry, text) {
  const form = entry?.japanese?.[0];
  const base = form?.word ?? form?.reading;
  const inflecting = (entry?.senses ?? []).some((sense) => sense.parts_of_speech?.some((pos) => /verb|adjective/i.test(pos)));
  if (!base || !inflecting || base === text) return null;
  const stem = base.slice(0, -1);
  if (!stem || !text.startsWith(stem) || !KANA_ONLY.test(text.slice(stem.length))) return null;
  // The word's reading is the base form's reading with the same ending: たべる -> たべ + た.
  const baseReading = form.word ? (form.reading ?? "") : "";
  return {
    base: { word: base, reading: baseReading, formOf: `conjugated form of ${base}` },
    reading: baseReading ? baseReading.slice(0, -1) + text.slice(stem.length) : "",
  };
}

// Only an entry for exactly this word counts; a related word would give a wrong reading.
export function parse(data, text) {
  const entries = data?.data ?? [];
  for (const entry of entries) {
    const form = (entry.japanese ?? []).find((j) => j.word === text || (!j.word && j.reading === text));
    if (!form) continue;
    return {
      // Words written in kana need no reading.
      reading: form.word ? (form.reading ?? "") : "",
      definitions: definitionsOf(entry),
      frequency: frequencyOf(entry),
      base: null,
    };
  }
  const inflection = deinflected(entries[0], text);
  if (inflection) return { ...inflection, definitions: definitionsOf(entries[0]), frequency: frequencyOf(entries[0]) };
  return { reading: "", definitions: [], frequency: null, base: null };
}
