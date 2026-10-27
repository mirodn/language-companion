// Wires page selection -> lookup -> card -> Anki.
(() => {
  const LC = globalThis.LC;
  const { MSG, selection } = LC;

  let settings = null;
  let ui = null;
  let lookupId = 0;
  // Last lookup request, so changing the source language can repeat it.
  let lastRequest = null;

  async function send(type, payload = {}) {
    const response = await browser.runtime.sendMessage({ type, ...payload });
    if (!response?.ok) throw new Error(response?.error ?? "No response from the extension.");
    return response.data;
  }

  function enabledHere() {
    return settings && !LC.settings.isSiteDisabled(settings, location.hostname);
  }

  async function getUI() {
    ui ??= new LC.CompanionUI({
      css: await send(MSG.GET_CARD_CSS),
      theme: settings.theme,
      handlers: {
        onTrigger: () => openFromSelection(),
        onAdd: (card) => addToAnki(card),
        onOpenInAnki: (card) => send(MSG.ANKI_BROWSE, { card }).catch((error) => ui.setAnkiState("error", error.message)),
        onSourceLangChange: (sourceLang) => lastRequest && runLookup({ ...lastRequest, sourceLang }),
        onDeckChange: (card) => {
          LC.settings.saveSettings({ deck: card.deck });
          checkDuplicate(card);
        },
        onCardChanged: (card) => checkDuplicate(card),
        onClose: () => (lookupId += 1),
      },
    });
    return ui;
  }

  // --- Lookup ------------------------------------------------------------------

  async function openFromSelection({ autoAdd = false, text } = {}) {
    const info = selection.current(settings.maxSelectionLength);
    // The context menu passes its own text; prefer the live selection for the sentence and position.
    const request = info ?? (text ? { text, sentence: "", pageLang: document.documentElement.lang, rect: centerRect() } : null);
    if (!request) return;
    await runLookup(request, { autoAdd });
  }

  async function runLookup(request, { autoAdd = false } = {}) {
    lastRequest = request;
    const id = ++lookupId;
    const card = await getUI();
    card.open(request.rect, request.text);

    let result;
    try {
      result = await send(MSG.LOOKUP, {
        text: request.text,
        sentence: request.sentence,
        pageLang: request.pageLang,
        sourceLang: request.sourceLang,
      });
    } catch (error) {
      if (id === lookupId) card.setLookupError(error.message);
      return;
    }
    if (id !== lookupId) return;
    card.setResult(result);

    try {
      card.setDecks(await send(MSG.ANKI_DECKS), settings.deck);
    } catch (error) {
      if (id === lookupId) card.setAnkiState("error", error.message);
      return;
    }
    if (id !== lookupId) return;
    await checkDuplicate(card.getCard());
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
      if (id === lookupId) ui.setAnkiState("error", error.message);
    }
  }

  async function addToAnki(cardData) {
    const id = lookupId;
    ui.setAnkiState("adding");
    try {
      const { duplicate } = await send(MSG.ANKI_ADD_NOTE, { card: cardData });
      if (id === lookupId) ui.setAnkiState(duplicate ? "duplicate" : "added");
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

  document.addEventListener("mouseup", (event) => {
    if (!enabledHere() || ui?.contains(event.target) || event.button !== 0) return;
    // The selection is only final after the mouseup has been processed.
    setTimeout(() => {
      const info = selection.current(settings.maxSelectionLength);
      if (!info) return ui?.hideTrigger();
      if (settings.triggerMode === "instant") runLookup(info);
      else if (settings.triggerMode === "icon") getUI().then((card) => card.showTrigger(info.rect));
    }, 0);
  });

  document.addEventListener(
    "mousedown",
    (event) => {
      if (!ui || ui.contains(event.target)) return;
      ui.hideTrigger();
      ui.close();
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (ui?.handleKey(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type !== MSG.OPEN_CARD || !settings?.enabled) return;
    openFromSelection({ autoAdd: message.autoAdd, text: message.text });
  });

  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "sync") return;
    settings = await LC.settings.getSettings();
    ui?.setTheme(settings.theme);
    if (!enabledHere()) {
      ui?.close();
      ui?.hideTrigger();
    }
  });

  LC.settings.getSettings().then((loaded) => (settings = loaded));
})();
