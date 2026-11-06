import { STORAGE_KEY, loadLog } from "../background/word-log.js";
import { summarize } from "../stats/summary.js";

const { MSG, languages, settings: settingsStore } = globalThis.LC;

const $ = (selector) => document.querySelector(selector);
const ALL_SITES = { origins: ["<all_urls>"] };

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
}

// The current tab's hostname for http(s) pages, otherwise "".
async function currentHost() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  try {
    const url = new URL(tab?.url ?? "");
    return url.protocol === "http:" || url.protocol === "https:" ? url.hostname : "";
  } catch {
    return ""; // No page URL (e.g. a new tab).
  }
}

function showPaused(enabled) {
  document.body.classList.toggle("paused", !enabled);
  $("#paused").hidden = enabled;
}

// Switches for the current site: lookups, text in images, and YouTube subtitles on YouTube.
async function setupSite(settings, hostname) {
  const site = hostname.replace(/^www\./, "");
  $("#site").hidden = false;
  $("#site-name").textContent = site;

  $("#site-enabled").checked = !settings.disabledSites.includes(hostname);
  $("#site-enabled").addEventListener("change", (e) => {
    const others = settings.disabledSites.filter((other) => other !== hostname);
    settings.disabledSites = e.target.checked ? others : [...others, hostname];
    settingsStore.saveSettings({ disabledSites: settings.disabledSites });
  });

  // Text in images needs the all-sites permission: Firefox only lets extensions capture a tab
  // without a click with <all_urls>.
  const listed = settings.imageTextSites.some((other) => site === other || site.endsWith(`.${other}`));
  $("#image-text").checked = listed && (await browser.permissions.contains(ALL_SITES));
  $("#image-text").addEventListener("change", async (e) => {
    const sites = settings.imageTextSites.filter((other) => site !== other && !site.endsWith(`.${other}`));
    if (!e.target.checked) {
      settings.imageTextSites = sites;
      await settingsStore.saveSettings({ imageTextSites: sites });
      return;
    }
    // Saved without waiting: permissions.request has to run directly in the click handler, and
    // Firefox may close this popup while its prompt is open. The background tells the tabs once
    // the permission is granted.
    settings.imageTextSites = [...sites, site];
    settingsStore.saveSettings({ imageTextSites: settings.imageTextSites });
    e.target.checked = await browser.permissions.request(ALL_SITES);
  });

  if (site === "youtube.com" || site.endsWith(".youtube.com")) {
    $("#youtube-row").hidden = false;
    $("#youtube-enabled").checked = settings.youtubeEnabled;
    $("#youtube-enabled").addEventListener("change", (e) => settingsStore.saveSettings({ youtubeEnabled: e.target.checked }));
  }
}

function openPage(url) {
  browser.tabs.create({ url: browser.runtime.getURL(url) });
  window.close();
}

async function init() {
  const settings = await settingsStore.getSettings();

  $("#enabled").checked = settings.enabled;
  showPaused(settings.enabled);
  $("#enabled").addEventListener("change", (e) => {
    settingsStore.saveSettings({ enabled: e.target.checked });
    showPaused(e.target.checked);
  });

  const hostname = await currentHost();
  if (hostname) setupSite(settings, hostname);
  else $("#open-reader").hidden = true;

  $("#languages-link").textContent = settings.learning.map((code) => languages.name(code)).join(" · ");
  for (const link of [$("#open-options"), $("#languages-link")]) {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      browser.runtime.openOptionsPage();
      window.close();
    });
  }

  // Clean view of the current page's article with clickable words (see src/reader).
  $("#open-reader").addEventListener("click", async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const response = await browser.runtime.sendMessage({ type: MSG.OPEN_READER, tabId: tab.id });
    if (response.ok) return window.close();
    $("#reader-error").textContent = response.error;
    $("#reader-error").hidden = false;
  });

  // Anki status, saved words and stats only matter when saving to Anki is on.
  if (!settings.ankiEnabled) return;
  $("#anki").hidden = false;
  $("#open-stats").addEventListener("click", (e) => {
    e.preventDefault();
    openPage("src/stats/stats.html");
  });
  showSummary();
  // A successful status check also adds waiting notes, which updates the log.
  browser.storage.onChanged.addListener((changes, area) => area === "local" && changes[STORAGE_KEY] && showSummary());
  showAnkiStatus();
}

// Switches start animating only after the page has painted its settings (.ready in page.css).
init().finally(() => requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add("ready"))));
