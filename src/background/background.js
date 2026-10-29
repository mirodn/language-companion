import "../shared/messages.js";
import "../shared/settings.js";
import { createAnkiClient, buildNote, duplicateQuery, resolveNoteType, NOTE_TYPE } from "./anki.js";
import { lookupDetails, lookupTranslation } from "./lookup.js";
import { getCached, setCached } from "./cache.js";

const { MSG, settings: settingsStore } = globalThis.LC;

// --- Setup ------------------------------------------------------------------

browser.runtime.onInstalled.addListener(({ reason }) => {
  setupMenus();
  if (reason === "install") browser.runtime.openOptionsPage();
});
browser.runtime.onStartup.addListener(setupMenus);

function setupMenus() {
  browser.menus.removeAll().then(() => {
    browser.menus.create({ id: "lookup", title: 'Look up "%s"', contexts: ["selection"] });
  });
}

browser.menus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "lookup" || !tab?.id) return;
  browser.tabs.sendMessage(tab.id, { type: MSG.OPEN_CARD, text: info.selectionText }, { frameId: info.frameId });
});

browser.commands.onCommand.addListener(async (command, tab) => {
  tab ??= (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.id) return;
  browser.tabs.sendMessage(tab.id, { type: MSG.OPEN_CARD, autoAdd: command === "lookup-and-add" }).catch(() => {
    // No content script on this page (e.g. about: pages).
  });
});

// --- Anki ---------------------------------------------------------------------

async function anki() {
  const settings = await settingsStore.getSettings();
  return { client: createAnkiClient({ url: settings.ankiUrl, key: settings.ankiKey }), settings };
}

let noteTypeChecked = false;

async function ensureNoteType(client, settings) {
  if (resolveNoteType(settings).modelName !== NOTE_TYPE || noteTypeChecked) return;
  await client.ensureNoteType();
  noteTypeChecked = true;
}

// --- Messages -----------------------------------------------------------------

const lookupContext = {
  detectLanguage: (text) => browser.i18n.detectLanguage(text),
  cache: { get: getCached, set: setCached },
};

const handlers = {
  async [MSG.LOOKUP](message) {
    return lookupTranslation(message, await settingsStore.getSettings(), lookupContext);
  },

  async [MSG.LOOKUP_DETAILS](message) {
    return lookupDetails(message, await settingsStore.getSettings(), lookupContext);
  },

  async [MSG.GET_CARD_CSS]() {
    const response = await fetch(browser.runtime.getURL("src/content/content.css"));
    return response.text();
  },

  async [MSG.ANKI_STATUS]() {
    const { client } = await anki();
    // requestPermission doubles as a status check; Anki only shows a dialog the first time.
    const result = await client.requestPermission();
    if (result.permission !== "granted") throw new Error("Permission denied in Anki.");
    return { version: result.version };
  },

  async [MSG.ANKI_DECKS]() {
    const { client } = await anki();
    return (await client.deckNames()).sort((a, b) => a.localeCompare(b));
  },

  async [MSG.ANKI_MODELS]() {
    const { client } = await anki();
    return (await client.modelNames()).sort((a, b) => a.localeCompare(b));
  },

  async [MSG.ANKI_MODEL_FIELDS]({ modelName }) {
    const { client } = await anki();
    return client.modelFieldNames(modelName);
  },

  async [MSG.ANKI_CHECK_DUPLICATE]({ card }) {
    const { client, settings } = await anki();
    await ensureNoteType(client, settings);
    return client.checkNote(buildNote(card, settings));
  },

  async [MSG.ANKI_ADD_NOTE]({ card }) {
    const { client, settings } = await anki();
    await ensureNoteType(client, settings);
    try {
      return { noteId: await client.addNote(buildNote(card, settings)) };
    } catch (error) {
      if (/duplicate/i.test(error.message)) return { duplicate: true };
      throw error;
    }
  },

  async [MSG.ANKI_BROWSE]({ card }) {
    const { client, settings } = await anki();
    return client.browse(duplicateQuery(card, settings));
  },
};

// Every response is { ok: true, data } or { ok: false, error } so callers get readable errors.
browser.runtime.onMessage.addListener((message) => {
  const handler = handlers[message?.type];
  if (!handler) return undefined;
  return handler(message).then(
    (data) => ({ ok: true, data }),
    (error) => {
      // A failed request may mean the note type was deleted in Anki; check again next time.
      noteTypeChecked = false;
      return { ok: false, error: error.message ?? String(error) };
    },
  );
});
