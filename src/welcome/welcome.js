// First-run setup: languages, a place to try a lookup, and optionally connecting Anki and its decks.
// Opened on install (background.js) and from the settings ("Run setup again").

const { MSG, languages, settings: settingsStore } = globalThis.LC;

const $ = (selector) => document.querySelector(selector);

const SAMPLES = {
  ja: { text: "週末は友達と新しいカフェに行きました。", translation: "I went to a new café with friends on the weekend." },
  ko: { text: "주말에 친구와 새로운 카페에 갔어요.", translation: "I went to a new café with a friend on the weekend." },
};
const NEW_DECK = "new:";

let settings;
let decks = null;

async function send(type, payload = {}) {
  const response = await browser.runtime.sendMessage({ type, ...payload });
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// --- 1. Languages ---------------------------------------------------------------------------

function renderLanguages() {
  const labels = languages.learnable.map(({ code, name }) => {
    const checked = settings.learning.includes(code);
    const checkbox = el("input", { type: "checkbox", checked, disabled: checked && settings.learning.length === 1 });
    checkbox.addEventListener("change", async () => {
      settings.learning = checkbox.checked
        ? [...settings.learning, code]
        : settings.learning.filter((other) => other !== code);
      await settingsStore.saveSettings({ learning: settings.learning });
      renderAll();
    });
    return el("label", {}, checkbox, name);
  });
  $("#languages").replaceChildren(...labels);
}

// --- Optional: Anki -------------------------------------------------------------------------

function renderAnki() {
  $("#anki-enabled").checked = settings.ankiEnabled;
  $("#anki-setup").hidden = !settings.ankiEnabled;
}

async function toggleAnki(enabled) {
  settings.ankiEnabled = enabled;
  await settingsStore.saveSettings({ ankiEnabled: enabled });
  renderAnki();
  if (enabled) checkAnki({ quiet: true });
}

async function checkAnki({ quiet = false } = {}) {
  const status = $("#anki-status");
  if (!quiet) {
    status.className = "muted";
    status.textContent = "Connecting… If Anki asks whether to allow this extension, click Yes.";
  }
  try {
    const { version } = await send(MSG.ANKI_STATUS);
    $("#anki-badge").textContent = "✓ Connected";
    status.className = "success";
    status.textContent = `Connected to AnkiConnect v${version}.`;
    decks = await send(MSG.ANKI_DECKS);
    renderDecks();
  } catch (error) {
    if (quiet) return;
    status.className = "error";
    status.textContent = error.message;
  }
}

// Decks

// Saved deck, else an existing deck named like the language, else none yet (Anki's "Default").
function currentDeck(code) {
  const name = languages.name(code);
  return settings.decks[code] || (decks.includes(name) ? name : "");
}

function renderDecks() {
  $("#decks-hint").hidden = Boolean(decks);
  if (!decks) return $("#decks").replaceChildren();

  const rows = settings.learning.map((code) => {
    const name = languages.name(code);
    const current = currentDeck(code);
    // An existing deck with the language's name is used without asking.
    if (current && !settings.decks[code]) saveDeck(code, current);

    const select = el("select", { id: `deck-${code}` });
    if (!decks.includes(name)) select.append(new Option(`+ New deck “${name}”`, NEW_DECK + name));
    if (!current) select.append(new Option("Choose a deck…", "", true, true));
    select.append(...decks.map((deck) => new Option(deck, deck, false, deck === current)));
    select.addEventListener("change", () => chooseDeck(code, select.value));
    return el("div", { className: "deck-row" }, el("label", { htmlFor: select.id }, name), select);
  });
  $("#decks").replaceChildren(...rows);
}

async function saveDeck(code, deck) {
  settings.decks = { ...settings.decks, [code]: deck };
  await settingsStore.saveSettings({ decks: settings.decks });
}

async function chooseDeck(code, value) {
  if (!value) return;
  let deck = value;
  if (value.startsWith(NEW_DECK)) {
    deck = value.slice(NEW_DECK.length);
    try {
      await send(MSG.ANKI_CREATE_DECK, { deck });
      decks = [...decks, deck].sort((a, b) => a.localeCompare(b));
    } catch (error) {
      $("#anki-status").className = "error";
      $("#anki-status").textContent = error.message;
      return;
    }
  }
  await saveDeck(code, deck);
  renderDecks();
}

// --- Try it ---------------------------------------------------------------------------------

function renderSamples() {
  // The translation is outside the paragraph, so it doesn't end up in the saved sentence.
  const samples = settings.learning.map((code) =>
    el("div", { className: "sample" }, el("p", { lang: code }, SAMPLES[code].text), el("span", { className: "translation" }, SAMPLES[code].translation)),
  );
  $("#samples").replaceChildren(...samples);
}

// --- Page -----------------------------------------------------------------------------------

function renderAll() {
  renderLanguages();
  renderAnki();
  renderDecks();
  renderSamples();
}

function bindCopyButtons() {
  for (const button of document.querySelectorAll("[data-copy]")) {
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText($(`#${button.dataset.copy}`).textContent);
      button.textContent = "Copied ✓";
      setTimeout(() => (button.textContent = "Copy"), 1500);
    });
  }
}

async function init() {
  settings = await settingsStore.getSettings();
  // The line to add to AnkiConnect's webCorsOriginList, e.g. "moz-extension://1234-…",
  $("#origin-line").textContent = `"${browser.runtime.getURL("").replace(/\/$/, "")}",`;
  bindCopyButtons();
  renderAll();

  $("#anki-enabled").addEventListener("change", (event) => toggleAnki(event.target.checked));
  $("#check-anki").addEventListener("click", () => checkAnki());
  // Coming back from Anki's config is the moment it may have started working.
  window.addEventListener("focus", () => settings.ankiEnabled && !decks && checkAnki({ quiet: true }));
  $("#open-options").addEventListener("click", (event) => {
    event.preventDefault();
    browser.runtime.openOptionsPage();
  });
  if (settings.ankiEnabled) checkAnki({ quiet: true });
}

init();
