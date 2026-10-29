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

async function init() {
  const settings = await settingsStore.getSettings();

  $("#enabled").checked = settings.enabled;
  $("#enabled").addEventListener("change", (e) => settingsStore.saveSettings({ enabled: e.target.checked }));

  $("#youtube-enabled").checked = settings.youtubeEnabled;
  $("#youtube-enabled").addEventListener("change", (e) => settingsStore.saveSettings({ youtubeEnabled: e.target.checked }));

  $("#open-options").addEventListener("click", (e) => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
    window.close();
  });

  showAnkiStatus();
}

init();
