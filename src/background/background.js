import "../shared/messages.js";
import "../shared/settings.js";
import { createAnkiClient, buildNote, duplicateQuery, resolveNoteType, NOTE_TYPE } from "./anki.js";
import { lookupDetails, lookupTranslation } from "./lookup.js";
import { createFrequency } from "./frequency.js";
import { getCached, setCached } from "./cache.js";
import { flushQueue, loadLog, logAdded, queueNote, removeEntry } from "./word-log.js";

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

// --- Notes saved while Anki was closed ------------------------------------------

const FLUSH_ALARM = "flush-queue";
const FLUSH_PERIOD_MINUTES = 2;

function scheduleFlush() {
  browser.alarms.create(FLUSH_ALARM, { periodInMinutes: FLUSH_PERIOD_MINUTES });
}

let flushing = null;

// Adds queued notes to Anki. The alarm keeps retrying until the queue is empty.
function runFlush() {
  flushing ??= (async () => {
    const { client, settings } = await anki();
    const result = await flushQueue(async (note) => {
      await ensureNoteType(client, settings);
      return client.addNote(note);
    });
    if (!result.remaining) await browser.alarms.clear(FLUSH_ALARM);
    return result;
  })().finally(() => (flushing = null));
  return flushing;
}

browser.alarms.onAlarm.addListener(({ name }) => {
  if (name === FLUSH_ALARM) runFlush().catch(() => {});
});

// Alarms don't survive a browser restart, so pick up a queue left from the last session.
loadLog().then((entries) => entries.some((entry) => entry.status === "queued") && scheduleFlush());

// --- Messages -----------------------------------------------------------------

const lookupContext = {
  detectLanguage: (text) => browser.i18n.detectLanguage(text),
  cache: { get: getCached, set: setCached },
  frequency: createFrequency(),
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
    runFlush().catch(() => {});
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
    const note = buildNote(card, settings);
    try {
      await ensureNoteType(client, settings);
      const noteId = await client.addNote(note);
      await logAdded(card, note);
      return { noteId };
    } catch (error) {
      if (/duplicate/i.test(error.message)) return { duplicate: true };
      if (!error.unreachable) throw error;
      // Anki is closed: keep the note and add it once Anki is open again.
      await queueNote(card, note);
      scheduleFlush();
      return { queued: true };
    }
  },

  async [MSG.ANKI_BROWSE]({ card }) {
    const { client, settings } = await anki();
    return client.browse(duplicateQuery(card, settings));
  },

  [MSG.QUEUE_FLUSH]: () => runFlush(),

  [MSG.LOG_REMOVE]: ({ id }) => removeEntry(id),
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
      return { ok: false, error: error.message ?? String(error), unreachable: Boolean(error.unreachable) };
    },
  );
});
