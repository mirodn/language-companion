import { STORAGE_KEY, loadLog } from "../background/word-log.js";
import { summarize } from "../stats/summary.js";

const { MSG, settings: settingsStore } = globalThis.LC;

const $ = (selector) => document.querySelector(selector);

async function showAnkiStatus() {
  const dot = $("#anki-status .dot");
  const text = $("#anki-status .text");
  const response = await browser.runtime.sendMessage({ type: MSG.ANKI_STATUS });
  dot.classList.toggle("ok", response.ok);
  dot.classList.toggle("fail", !response.ok);
  text.textContent = response.ok ? `Connected to Anki (AnkiConnect v${response.data.version})` : response.error;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// "12 words this week · 3 waiting for Anki"
async function showSummary() {
  const { thisWeek, queued } = summarize(await loadLog());
  const parts = [`${plural(thisWeek, "word")} this week`];
  if (queued.length) parts.push(`${queued.length} waiting for Anki`);
  $("#summary").textContent = parts.join(" · ");
  $("#summary").hidden = false;
}

async function init() {
  const settings = await settingsStore.getSettings();

  $("#enabled").checked = settings.enabled;
  $("#enabled").addEventListener("change", (e) => settingsStore.saveSettings({ enabled: e.target.checked }));

  $("#youtube-enabled").checked = settings.youtubeEnabled;
  $("#youtube-enabled").addEventListener("change", (e) => settingsStore.saveSettings({ youtubeEnabled: e.target.checked }));

  $("#youtube-dual").checked = settings.youtubeDualSubtitles;
  $("#youtube-dual").addEventListener("change", (e) => settingsStore.saveSettings({ youtubeDualSubtitles: e.target.checked }));

  $("#open-options").addEventListener("click", (e) => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
    window.close();
  });

  $("#open-stats").addEventListener("click", (e) => {
    e.preventDefault();
    browser.tabs.create({ url: browser.runtime.getURL("src/stats/stats.html") });
    window.close();
  });

  showSummary();
  // A successful status check also adds waiting notes, which updates the log.
  browser.storage.onChanged.addListener((changes, area) => area === "local" && changes[STORAGE_KEY] && showSummary());
  showAnkiStatus();
}

init();
