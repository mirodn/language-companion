// Supported languages and per-provider language codes.
(() => {
  const LC = (globalThis.LC ??= {});

  // code: ISO 639-1 (used internally, by Wiktionary, MyMemory and LibreTranslate)
  // tatoeba: ISO 639-3 code used by Tatoeba
  // deepl: DeepL source code, or null if DeepL does not support the language
  // cjk: no spaces between words; affects sentence splitting and future furigana support
  const LANGUAGES = [
    { code: "en", name: "English", tatoeba: "eng", deepl: "EN" },
    { code: "fr", name: "French", tatoeba: "fra", deepl: "FR" },
    { code: "ja", name: "Japanese", tatoeba: "jpn", deepl: "JA", cjk: true },
    { code: "ko", name: "Korean", tatoeba: "kor", deepl: "KO" },
    { code: "ru", name: "Russian", tatoeba: "rus", deepl: "RU" },
    { code: "sq", name: "Albanian", tatoeba: "sqi", deepl: null },
    { code: "tr", name: "Turkish", tatoeba: "tur", deepl: "TR" },
  ];

  // Everything is translated into English; the other languages are the ones being learned.
  const TARGET = "en";

  const byCode = new Map(LANGUAGES.map((lang) => [lang.code, lang]));

  // Writing systems that identify a language on their own within this language list.
  // Kanji alone (no kana) still means Japanese, since Chinese is not supported.
  const SCRIPTS = [
    [/[\u3040-\u30ff]/, "ja"],
    [/[\uac00-\ud7af\u1100-\u11ff]/, "ko"],
    [/[\u4e00-\u9fff]/, "ja"],
    [/[\u0400-\u04ff]/, "ru"],
  ];
  // Letters only one of the Latin-script languages here uses. Ambiguous ones (ç, ö, ü) are left out.
  const LETTERS = [
    [/[ğışİ]/i, "tr"],
    [/ë/i, "sq"],
    [/[éèêàâîôûùœ]/i, "fr"],
  ];
  const firstMatch = (rules, text) => rules.find(([pattern]) => pattern.test(text))?.[1] ?? null;

  // Normalizes tags like "en-US", "fr_CA" or "ja-JP" to a supported base code, or null.
  function normalize(tag) {
    if (!tag) return null;
    const base = String(tag).toLowerCase().split(/[-_]/)[0];
    return byCode.has(base) ? base : null;
  }

  LC.languages = Object.freeze({
    list: LANGUAGES,
    get: (code) => byCode.get(code) ?? null,
    name: (code) => byCode.get(code)?.name ?? code,
    normalize,
    target: TARGET,
    byScript: (text) => firstMatch(SCRIPTS, text),
    byLetters: (text) => firstMatch(LETTERS, text),
    // Sentence boundary characters, including CJK punctuation.
    sentenceBreak: /[.!?。！？…]+["'”’)\]]*\s*|\n{2,}/g,
  });
})();
