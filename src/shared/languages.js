// Supported languages and per-provider language codes.
(() => {
  const LC = (globalThis.LC ??= {});

  // code: ISO 639-1 (used internally, by Wiktionary, MyMemory and LibreTranslate)
  // tatoeba: ISO 639-3 code used by Tatoeba
  // deepl: DeepL source code, or null if DeepL does not support the language
  // cjk: no spaces between words; affects sentence splitting and future furigana support
  const LANGUAGES = [
    { code: "ar", name: "Arabic", tatoeba: "ara", deepl: "AR" },
    { code: "bg", name: "Bulgarian", tatoeba: "bul", deepl: "BG" },
    { code: "cs", name: "Czech", tatoeba: "ces", deepl: "CS" },
    { code: "da", name: "Danish", tatoeba: "dan", deepl: "DA" },
    { code: "de", name: "German", tatoeba: "deu", deepl: "DE" },
    { code: "el", name: "Greek", tatoeba: "ell", deepl: "EL" },
    { code: "en", name: "English", tatoeba: "eng", deepl: "EN" },
    { code: "es", name: "Spanish", tatoeba: "spa", deepl: "ES" },
    { code: "fi", name: "Finnish", tatoeba: "fin", deepl: "FI" },
    { code: "fr", name: "French", tatoeba: "fra", deepl: "FR" },
    { code: "he", name: "Hebrew", tatoeba: "heb", deepl: "HE" },
    { code: "hi", name: "Hindi", tatoeba: "hin", deepl: null },
    { code: "hu", name: "Hungarian", tatoeba: "hun", deepl: "HU" },
    { code: "id", name: "Indonesian", tatoeba: "ind", deepl: "ID" },
    { code: "it", name: "Italian", tatoeba: "ita", deepl: "IT" },
    { code: "ja", name: "Japanese", tatoeba: "jpn", deepl: "JA", cjk: true },
    { code: "ko", name: "Korean", tatoeba: "kor", deepl: "KO" },
    { code: "nl", name: "Dutch", tatoeba: "nld", deepl: "NL" },
    { code: "no", name: "Norwegian", tatoeba: "nob", deepl: "NB" },
    { code: "pl", name: "Polish", tatoeba: "pol", deepl: "PL" },
    { code: "pt", name: "Portuguese", tatoeba: "por", deepl: "PT" },
    { code: "ro", name: "Romanian", tatoeba: "ron", deepl: "RO" },
    { code: "ru", name: "Russian", tatoeba: "rus", deepl: "RU" },
    { code: "sv", name: "Swedish", tatoeba: "swe", deepl: "SV" },
    { code: "th", name: "Thai", tatoeba: "tha", deepl: null, cjk: true },
    { code: "tr", name: "Turkish", tatoeba: "tur", deepl: "TR" },
    { code: "uk", name: "Ukrainian", tatoeba: "ukr", deepl: "UK" },
    { code: "vi", name: "Vietnamese", tatoeba: "vie", deepl: "VI" },
    { code: "zh", name: "Chinese", tatoeba: "cmn", deepl: "ZH", cjk: true },
  ];

  const byCode = new Map(LANGUAGES.map((lang) => [lang.code, lang]));

  // Normalizes tags like "en-US", "pt_BR" or "zh-Hans" to a supported base code, or null.
  function normalize(tag) {
    if (!tag) return null;
    const base = String(tag).toLowerCase().split(/[-_]/)[0];
    if (base === "nb" || base === "nn") return "no";
    if (base === "iw") return "he";
    return byCode.has(base) ? base : null;
  }

  LC.languages = Object.freeze({
    list: LANGUAGES,
    get: (code) => byCode.get(code) ?? null,
    name: (code) => byCode.get(code)?.name ?? code,
    normalize,
    // Sentence boundary characters, including CJK punctuation.
    sentenceBreak: /[.!?。！？…]+["'”’)\]]*\s*|\n{2,}/g,
  });
})();
