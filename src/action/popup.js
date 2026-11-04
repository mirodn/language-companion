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

// Text in images (manga, webtoons) for the current site. It needs the all-sites permission,
// because Firefox only lets extensions capture a tab without a click with <all_urls>.
async function setupImageText(settings) {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  let hostname = "";
  try {
    const url = new URL(tab?.url ?? "");
    if (url.protocol === "http:" || url.protocol === "https:") hostname = url.hostname.replace(/^www\./, "");
  } catch {
    // No page URL (e.g. a new tab).
  }
  if (!hostname) return;
  const ALL_SITES = { origins: ["<all_urls>"] };
  const listed = settings.imageTextSites.some((site) => hostname === site || hostname.endsWith(`.${site}`));
  $("#image-text-site").textContent = hostname;
  $("#image-text").checked = listed && (await browser.permissions.contains(ALL_SITES));
  $("#image-text-row").hidden = false;

  $("#image-text").addEventListener("change", async (e) => {
    const sites = settings.imageTextSites.filter((site) => hostname !== site && !hostname.endsWith(`.${site}`));
    if (!e.target.checked) {
      await settingsStore.saveSettings({ imageTextSites: sites });
      return;
    }
    // Saved without waiting: permissions.request has to run directly in the click handler, and
    // Firefox may close this popup while its prompt is open. The background tells the tabs once
    // the permission is granted.
    settings.imageTextSites = [...sites, hostname];
    settingsStore.saveSettings({ imageTextSites: settings.imageTextSites });
    e.target.checked = await browser.permissions.request(ALL_SITES);
  });
}

async function init() {
  const settings = await settingsStore.getSettings();

  $("#enabled").checked = settings.enabled;
  $("#enabled").addEventListener("change", (e) => settingsStore.saveSettings({ enabled: e.target.checked }));

  $("#youtube-enabled").checked = settings.youtubeEnabled;
  $("#youtube-enabled").addEventListener("change", (e) => settingsStore.saveSettings({ youtubeEnabled: e.target.checked }));

  setupImageText(settings);

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

  // Clean view of the current page's article with clickable words (see src/reader).
  $("#open-reader").addEventListener("click", async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const response = await browser.runtime.sendMessage({ type: MSG.OPEN_READER, tabId: tab.id });
    if (response.ok) return window.close();
    $("#reader-error").textContent = response.error;
    $("#reader-error").hidden = false;
  });

  // Anki status, saved words and stats only matter when saving to Anki is on.
  $("#stats-link").hidden = !settings.ankiEnabled;
  if (!settings.ankiEnabled) return;
  $("#anki-status").hidden = false;
  showSummary();
  // A successful status check also adds waiting notes, which updates the log.
  browser.storage.onChanged.addListener((changes, area) => area === "local" && changes[STORAGE_KEY] && showSummary());
  showAnkiStatus();
}

init();
