// Wires page selection -> lookup -> card -> Anki.
(() => {
  const LC = globalThis.LC;
  const { MSG, selection, languages } = LC;

  let settings = null;
  let ui = null;
  let lookupId = 0;
  // Last lookup request, so looking up the base form can reuse its sentence and context.
  let lastRequest = null;
  // The lookup id when a click outside the card started. If the click ends without a new lookup
  // or a new selection to look up, it was a plain click and closes the card.
  let pressedAt = null;
  // The selection the lookup button was shown for. Callers like image-text.js describe their
  // selections better than the page selection does (sentence, context).
  let offered = null;
  const closeListeners = [];

  async function send(type, payload = {}) {
    const response = await browser.runtime.sendMessage({ type, ...payload });
    if (!response?.ok) {
      const error = new Error(response?.error ?? "No response from the extension.");
      // Anki is closed; notes can still be saved and are added later.
      error.unreachable = Boolean(response?.unreachable);
      throw error;
    }
    return response.data;
  }

  function enabledHere() {
    return settings && !LC.settings.isSiteDisabled(settings, location.hostname);
  }

  function cardOptions() {
    return { showSentenceTranslation: settings.showSentenceTranslation, anki: settings.ankiEnabled };
  }

  async function getUI() {
    ui ??= new LC.CompanionUI({
      css: await send(MSG.GET_CARD_CSS),
      theme: settings.theme,
      options: cardOptions(),
      handlers: {
        onTrigger: () => (offered ? runLookup(offered) : openFromSelection()),
        onAdd: (card) => addToAnki(card),
        onOpenInAnki: (card) => send(MSG.ANKI_BROWSE, { card }).catch((error) => ui.setAnkiState("error", error.message)),
        // Same sentence and context, but the base word; the card remembers the original word.
        onUseBaseForm: (word) =>
          lastRequest &&
          runLookup({ ...lastRequest, text: word, surface: lastRequest.surface ?? lastRequest.text, sourceLang: ui.getCard().sourceLang }),
        // The chosen deck becomes the deck for this card's language.
        onDeckChange: (card) => {
          LC.settings.saveSettings({ decks: { ...settings.decks, [card.sourceLang]: card.deck } });
          checkDuplicate(card);
        },
        onCardChanged: (card) => checkDuplicate(card),
        onClose: () => {
          lookupId += 1;
          closeListeners.forEach((listener) => listener());
        },
      },
    });
    return ui;
  }

  // Whether the text (and the sentence around it) is in one of the user's languages.
  function inMyLanguages(text, sentence) {
    return languages.isLearned([text, sentence], settings.learning);
  }

  // "Japanese", "Japanese or Korean"
  function myLanguageNames() {
    const names = settings.learning.map((code) => languages.name(code));
    return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0];
  }

  // --- Lookup ------------------------------------------------------------------

  async function openFromSelection({ autoAdd = false, text } = {}) {
    const info = selection.current(settings.maxSelectionLength);
    // The context menu passes its own text; prefer the live selection for the sentence and position.
    const request = info ?? (text ? { text, sentence: "", pageLang: document.documentElement.lang, rect: centerRect() } : null);
    if (!request) return;
    await runLookup(request, { autoAdd });
  }

  // request: { text, sentence, rect, pageLang, sourceLang?, contentLang?, context?, surface? }
  async function runLookup(request, { autoAdd = false } = {}) {
    lastRequest = request;
    const id = ++lookupId;
    const card = await getUI();
    card.open(request.rect, request.text, request.context);
    // Only reached through the shortcut or the context menu; the lookup button is not offered.
    if (!request.sourceLang && !inMyLanguages(request.text, request.sentence)) {
      card.setLookupError(`This text doesn't look like ${myLanguageNames()}. You can change your languages in the settings.`);
      return;
    }

    const payload = {
      text: request.text,
      sentence: request.sentence,
      pageLang: request.pageLang,
      sourceLang: request.sourceLang,
      contentLang: request.contentLang,
    };
    // Details (dictionaries, examples) are slower, so they fill in once the card is shown.
    const details = send(MSG.LOOKUP_DETAILS, payload).catch((error) => ({ errors: [error.message] }));

    let result;
    try {
      result = await send(MSG.LOOKUP, payload);
    } catch (error) {
      if (id === lookupId) card.setLookupError(error.message);
      return;
    }
    if (id !== lookupId) return;
    card.setResult({ ...result, ...(request.surface ? { surface: request.surface } : {}) });
    const detailsShown = details.then((data) => id === lookupId && card.setDetails(data));
    // Without Anki the card only translates.
    if (!settings.ankiEnabled) return;

    const deck = LC.settings.deckFor(settings, result.sourceLang);
    let offline = false;
    try {
      card.setDecks(await send(MSG.ANKI_DECKS), deck);
    } catch (error) {
      if (id !== lookupId) return;
      if (!error.unreachable) return card.setAnkiState("error", error.message);
      card.setDecks([], deck);
      card.setAnkiState("offline");
      offline = true;
    }
    if (id !== lookupId) return;
    if (!offline) await checkDuplicate(card.getCard());
    await detailsShown;
    if (autoAdd && id === lookupId) card.add();
  }

  async function checkDuplicate(cardData) {
    const id = lookupId;
    ui.setAnkiState("checking");
    try {
      const { duplicate, canAdd, error } = await send(MSG.ANKI_CHECK_DUPLICATE, { card: cardData });
      if (id !== lookupId) return;
      if (duplicate) ui.setAnkiState("duplicate");
      else if (!canAdd) ui.setAnkiState("error", error);
      else ui.setAnkiState("ready");
    } catch (error) {
      if (id === lookupId) ui.setAnkiState(error.unreachable ? "offline" : "error", error.message);
    }
  }

  async function addToAnki(cardData) {
    const id = lookupId;
    ui.setAnkiState("adding");
    try {
      const { duplicate, queued } = await send(MSG.ANKI_ADD_NOTE, { card: cardData });
      if (id === lookupId) ui.setAnkiState(queued ? "queued" : duplicate ? "duplicate" : "added");
    } catch (error) {
      if (id === lookupId) ui.setAnkiState("error", error.message);
    }
  }

  function centerRect() {
    const x = window.innerWidth / 2 - 180;
    const y = window.innerHeight / 3;
    return { left: x, right: x, top: y, bottom: y };
  }

  // --- Page events ---------------------------------------------------------------

  // Shows the lookup button next to a selection, or opens the card right away, as set in the
  // settings. info: { text, sentence, rect, pageLang, context? } (see selection.js), or null.
  function offerSelection(info) {
    offered = null;
    if (!info || !inMyLanguages(info.text, info.sentence)) {
      ui?.hideTrigger();
      return false;
    }
    offered = info;
    if (settings.triggerMode === "instant") runLookup(info);
    else if (settings.triggerMode === "icon") getUI().then((card) => card.showTrigger(info.rect));
    return true;
  }

  // An open card stays open while the user selects the next word, and shows that word instead.
  document.addEventListener("mouseup", (event) => {
    if (!enabledHere() || ui?.contains(event.target) || event.button !== 0) return;
    const pressed = pressedAt;
    pressedAt = null;
    // The selection is only final after the mouseup has been processed, and clicks on words in
    // the reader or in subtitles start their lookup in the click that follows.
    setTimeout(() => {
      // While a card is being edited, text on the page may be selected to copy into it.
      if (ui?.isEditing) return;
      const offered = offerSelection(selection.current(settings.maxSelectionLength));
      if (!offered && pressed !== null && pressed === lookupId) ui?.close();
    }, 0);
  });

  document.addEventListener(
    "mousedown",
    (event) => {
      if (!ui || ui.contains(event.target) || ui.isEditing) return;
      ui.hideTrigger();
      if (event.button === 0) pressedAt = lookupId;
      else ui.close();
    },
    true,
  );

  // Window capture runs before page handlers, so site shortcuts (e.g. YouTube's) don't fire.
  window.addEventListener(
    "keydown",
    (event) => {
      if (ui?.handleKey(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );

  document.addEventListener("fullscreenchange", () => {
    ui?.hideTrigger();
    ui?.close();
  });

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type !== MSG.OPEN_CARD || !settings?.enabled) return;
    openFromSelection({ autoAdd: message.autoAdd, text: message.text });
  });

  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "sync") return;
    settings = await LC.settings.getSettings();
    ui?.setTheme(settings.theme);
    ui?.setOptions(cardOptions());
    if (!enabledHere()) {
      ui?.close();
      ui?.hideTrigger();
    }
  });

  LC.settings.getSettings().then((loaded) => (settings = loaded));

  // Used by site integrations such as youtube.js.
  LC.companion = {
    lookup: runLookup,
    // For selections the page's own events don't report, e.g. in image-text.js.
    offerSelection: (info) => !ui?.isEditing && offerSelection(info),
    onClose: (listener) => closeListeners.push(listener),
    // Whether an event target is the extension's card or lookup button.
    contains: (target) => Boolean(ui?.contains(target)),
    // The open card's viewport rect, or null.
    cardRect: () => (ui?.isOpen ? ui.card.getBoundingClientRect() : null),
    get settings() {
      return settings;
    },
    enabledHere,
  };
})();
