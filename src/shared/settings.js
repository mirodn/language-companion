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

    translator: "mymemory",
    translateSentence: true,
    myMemoryEmail: "",
    deeplKey: "",
    libreUrl: "",
    libreKey: "",
    providers: { freedictionary: true, jisho: true, wiktionary: true, tatoeba: true, frequency: true },
    maxDefinitions: 4,
    maxExamples: 3,

    ankiUrl: "http://127.0.0.1:8765",
    ankiKey: "",
    // Deck per source language, e.g. { sq: "Albanian" }. Languages without one use `deck`.
    decks: {},
    deck: "Default",
    // "builtin": use the bundled "Language Companion" note type
    // "mapped": use an existing note type and map fields in the options page
    noteTypeMode: "builtin",
    mappedModel: "",
    fieldMap: {},
    tags: "language-companion",
    saveAudio: true,

    youtubeEnabled: true,
    youtubePauseOnClick: true,
    youtubeResumeOnClose: true,
    // Off by default: every subtitle line uses translator quota.
    youtubeDualSubtitles: false,
  });

  async function getSettings() {
    const stored = await browser.storage.sync.get(null);
    return {
      ...DEFAULTS,
      ...stored,
      providers: { ...DEFAULTS.providers, ...stored.providers },
      decks: { ...stored.decks },
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
