// Small persistent cache for lookup results in browser.storage.local.
// The background is an event page and may be unloaded, so in-memory caching alone is not enough.

const STORAGE_KEY = "lookupCache";
const MAX_ENTRIES = 500;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

async function load() {
  const { [STORAGE_KEY]: entries = {} } = await browser.storage.local.get(STORAGE_KEY);
  return entries;
}

export async function getCached(key) {
  const entry = (await load())[key];
  if (!entry || Date.now() - entry.at > MAX_AGE_MS) return null;
  return entry.value;
}

export async function setCached(key, value) {
  const entries = await load();
  entries[key] = { at: Date.now(), value };
  const keys = Object.keys(entries);
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => entries[a].at - entries[b].at)
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((oldKey) => delete entries[oldKey]);
  }
  await browser.storage.local.set({ [STORAGE_KEY]: entries });
}

export function clearCache() {
  return browser.storage.local.remove(STORAGE_KEY);
}
