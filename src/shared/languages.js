// Supported languages and per-provider language codes.
(() => {
  const LC = (globalThis.LC ??= {});

  // code: ISO 639-1 (used internally, by Wiktionary, MyMemory and LibreTranslate)
  // tatoeba: ISO 639-3 code used by Tatoeba
  // deepl: DeepL code
  // cjk: no spaces between words; affects phrase length and word splitting
  const LANGUAGES = [
    { code: "ja", name: "Japanese", tatoeba: "jpn", deepl: "JA", cjk: true },
    { code: "ko", name: "Korean", tatoeba: "kor", deepl: "KO" },
    // Everything is translated into English. English words get definitions only.
    { code: "en", name: "English", tatoeba: "eng", deepl: "EN" },
  ];

  const TARGET = "en";

  const byCode = new Map(LANGUAGES.map((lang) => [lang.code, lang]));

  const KANA = /[぀-ヿ]/;
  const HANGUL = /[가-힯ᄀ-ᇿ㄰-㆏]/;
  const HAN = /[㐀-䶿一-鿿]/;

  // Normalizes tags like "ja-JP" or "ko-KR" to a supported base code, or null.
  function normalize(tag) {
    if (!tag) return null;
    const base = String(tag).toLowerCase().split(/[-_]/)[0];
    return byCode.has(base) ? base : null;
  }

  // Kana means Japanese and Hangul Korean, checked in each text in turn (e.g. the word, then its
  // sentence). Kanji without kana is Japanese too, since it's the only language here that uses them.
  function byScript(texts) {
    const list = [texts].flat().filter(Boolean);
    for (const text of list) {
      if (KANA.test(text)) return "ja";
      if (HANGUL.test(text)) return "ko";
    }
    return list.some((text) => HAN.test(text)) ? "ja" : null;
  }

  // Whether text (e.g. [word, sentence]) is written in one of the user's languages. The extension
  // only offers lookups for those; everything else, English included, is left alone.
  function isLearned(texts, learning) {
    const lang = byScript(texts);
    return Boolean(lang && learning.includes(lang));
  }

  const segmenters = new Map();

  // Splits text into words and the bits between them (spaces, punctuation), in order, so the
  // pieces join back into the text: [{ text, start, end, isWord }]. Offsets are string indexes.
  function segmentWords(text, lang) {
    if (!segmenters.has(lang)) segmenters.set(lang, new Intl.Segmenter(lang || undefined, { granularity: "word" }));
    return [...segmenters.get(lang).segment(text)].map(({ segment, index, isWordLike }) => ({
      text: segment,
      start: index,
      end: index + segment.length,
      isWord: Boolean(isWordLike),
    }));
  }

  LC.languages = Object.freeze({
    list: LANGUAGES,
    // The languages a user can learn, i.e. add in the settings.
    learnable: LANGUAGES.filter((lang) => lang.code !== TARGET),
    get: (code) => byCode.get(code) ?? null,
    name: (code) => byCode.get(code)?.name ?? code,
    normalize,
    target: TARGET,
    byScript,
    isLearned,
    segmentWords,
    hasHan: (text) => HAN.test(text ?? ""),
    // Sentence boundary characters, including CJK punctuation.
    sentenceBreak: /[.!?。！？…]+["'”’)\]」』]*\s*|\n{2,}/g,
  });
})();
