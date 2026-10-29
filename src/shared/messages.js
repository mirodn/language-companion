// Message types exchanged between content scripts, extension pages and the background.
// Shared files are plain scripts (no `export`) so they work both as classic content
// scripts and as side-effect imports from ES modules. They populate `globalThis.LC`.
(() => {
  const LC = (globalThis.LC ??= {});

  LC.MSG = Object.freeze({
    GET_CARD_CSS: "getCardCss",
    LOOKUP: "lookup",
    LOOKUP_DETAILS: "lookupDetails",
    PEEK: "peek",
    ANKI_STATUS: "ankiStatus",
    ANKI_DECKS: "ankiDecks",
    ANKI_CREATE_DECK: "ankiCreateDeck",
    ANKI_MODELS: "ankiModels",
    ANKI_MODEL_FIELDS: "ankiModelFields",
    ANKI_CHECK_DUPLICATE: "ankiCheckDuplicate",
    ANKI_ADD_NOTE: "ankiAddNote",
    ANKI_BROWSE: "ankiBrowse",
    OPEN_READER: "openReader",
    QUEUE_FLUSH: "queueFlush",
    LOG_REMOVE: "logRemove",
    // Background -> content
    OPEN_CARD: "openCard",
  });
})();
