// Every word saved through the extension, kept in browser.storage.local for the stats page,
// including notes that wait for Anki because it was closed. Entries:
//   { id, at, word, lang, deck, host, status: "added" | "queued", note?, error? }
// Queued entries keep the complete AnkiConnect note and become "added" once Anki takes it.
// Only the background writes the log; extension pages read it and listen to storage.onChanged.

export const STORAGE_KEY = "wordLog";

export async function loadLog() {
  const { [STORAGE_KEY]: entries = [] } = await browser.storage.local.get(STORAGE_KEY);
  return entries;
}

// Read-modify-write steps run one after another, so a flush and a new word can't overwrite each other.
let lock = Promise.resolve();

function update(change) {
  const run = lock.then(async () => {
    const entries = await loadLog();
    const result = change(entries);
    await browser.storage.local.set({ [STORAGE_KEY]: entries });
    return result;
  });
  lock = run.catch(() => {});
  return run;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function entryFor(card, note) {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    word: card.word,
    lang: card.sourceLang,
    deck: note.deckName,
    host: hostOf(card.pageUrl),
  };
}

export function logAdded(card, note) {
  return update((entries) => void entries.push({ ...entryFor(card, note), status: "added" }));
}

export function queueNote(card, note) {
  return update((entries) => void entries.push({ ...entryFor(card, note), status: "queued", note }));
}

export function removeEntry(id) {
  return update((entries) => {
    const index = entries.findIndex((entry) => entry.id === id);
    if (index >= 0) entries.splice(index, 1);
  });
}

// Sends queued notes to Anki, oldest first, and stops as soon as Anki is unreachable.
// Notes Anki already has are dropped from the log; other errors are kept on the entry and retried.
// Returns { added, remaining, unreachable }.
export async function flushQueue(addNote) {
  const queued = (await loadLog()).filter((entry) => entry.status === "queued");
  let added = 0;
  let unreachable = false;
  for (const { id, note } of queued) {
    let outcome;
    try {
      await addNote(note);
      outcome = { status: "added" };
      added += 1;
    } catch (error) {
      if (error.unreachable) {
        unreachable = true;
        break;
      }
      outcome = /duplicate/i.test(error.message) ? null : { status: "queued", error: error.message };
    }
    await update((entries) => {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index < 0) return;
      if (!outcome) {
        entries.splice(index, 1);
      } else if (outcome.status === "added") {
        const { note: _note, error: _error, ...entry } = entries[index];
        entries[index] = { ...entry, status: "added" };
      } else {
        entries[index].error = outcome.error;
      }
    });
  }
  const remaining = (await loadLog()).filter((entry) => entry.status === "queued").length;
  return { added, remaining, unreachable };
}
