// Default settings and helpers around browser.storage.sync.
(() => {
  const LC = (globalThis.LC ??= {});

  const DEFAULTS = Object.freeze({
    enabled: true,
    disabledSites: [],

    // "icon": show a small button next to the selection
    // "instant": open the card right after selecting
    // "shortcut": only open via keyboard shortcut or context menu
    triggerMode: "icon",
    theme: "system",
    maxSelectionLength: 200,

    // The languages the user learns, in the order they were added. Changed in the settings.
    learning: ["ja"],

    translator: "mymemory",
    translateSentence: true,
    // Otherwise the sentence translation on the card starts hidden ("Show translation").
    showSentenceTranslation: true,
    myMemoryEmail: "",
    deeplKey: "",
    libreUrl: "",
    libreKey: "",
    providers: { freedictionary: true, jisho: true, kanjidic: true, wiktionary: true, tatoeba: true, frequency: true },
    maxDefinitions: 4,
    maxExamples: 3,

    // Saving words to Anki is optional. Off, the card only translates: no deck, no "Add to Anki".
    ankiEnabled: false,
    ankiUrl: "http://127.0.0.1:8765",
    ankiKey: "",
    // Deck per source language, e.g. { ja: "Japanese" }. Languages without one use `deck`.
    decks: {},
    deck: "Default",
    // "builtin": use the bundled "Language Companion" note type
    // "mapped": use an existing note type and map fields in the options page
    noteTypeMode: "builtin",
    mappedModel: "",
    fieldMap: {},
    tags: "language-companion",
    saveAudio: true,

    // Sites where text in images (manga, webtoons) is read and made clickable. Also needs the
    // optional <all_urls> permission, which the toolbar popup asks for.
    imageTextSites: ["shonenjumpplus.com"],

    youtubeEnabled: true,
    youtubePauseOnClick: true,
    youtubeResumeOnClose: true,
  });

  async function getSettings() {
    const stored = await browser.storage.sync.get(null);
    // Drops languages that are no longer supported (Chinese until 0.5; languages.js is not loaded
    // in every page), falling back to the default if none are left.
    const learning = (stored.learning ?? DEFAULTS.learning).filter((code) => LC.languages?.get(code) ?? code !== "zh");
    return {
      ...DEFAULTS,
      ...stored,
      providers: { ...DEFAULTS.providers, ...stored.providers },
      decks: { ...stored.decks },
      learning: learning.length ? learning : DEFAULTS.learning,
    };
  }

  function deckFor(settings, lang) {
    return settings.decks[lang] || settings.deck;
  }

  function saveSettings(patch) {
    return browser.storage.sync.set(patch);
  }

  function isSiteDisabled(settings, hostname) {
    return !settings.enabled || settings.disabledSites.includes(hostname);
  }

  LC.settings = Object.freeze({ DEFAULTS, getSettings, saveSettings, isSiteDisabled, deckFor });
})();
