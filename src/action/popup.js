const { MSG, languages, settings: settingsStore } = globalThis.LC;

const $ = (selector) => document.querySelector(selector);

function fillLanguageSelect(select, value, { includeAuto = false } = {}) {
  const options = languages.list.map((lang) => new Option(lang.name, lang.code));
  if (includeAuto) options.unshift(new Option("Auto-detect", "auto"));
  select.replaceChildren(...options);
  select.value = value;
}

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
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const hostname = tab?.url?.startsWith("http") ? new URL(tab.url).hostname : "";

  fillLanguageSelect($("#source-lang"), settings.sourceLang, { includeAuto: true });
  fillLanguageSelect($("#target-lang"), settings.targetLang);
  $("#source-lang").addEventListener("change", (e) => settingsStore.saveSettings({ sourceLang: e.target.value }));
  $("#target-lang").addEventListener("change", (e) => settingsStore.saveSettings({ targetLang: e.target.value }));

  $("#enabled").checked = settings.enabled;
  $("#enabled").addEventListener("change", (e) => settingsStore.saveSettings({ enabled: e.target.checked }));

  if (hostname) {
    $("#site-label").textContent = `Enabled on ${hostname}`;
    $("#site-enabled").checked = !settings.disabledSites.includes(hostname);
    $("#site-enabled").addEventListener("change", async (e) => {
      const { disabledSites } = await settingsStore.getSettings();
      const sites = new Set(disabledSites);
      if (e.target.checked) sites.delete(hostname);
      else sites.add(hostname);
      settingsStore.saveSettings({ disabledSites: [...sites] });
    });
  } else {
    $("#site-enabled").closest("label").hidden = true;
  }

  $("#open-options").addEventListener("click", (e) => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
    window.close();
  });

  showAnkiStatus();
}

init();
