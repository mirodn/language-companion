import { NOTE_FIELDS } from "../background/anki.js";
import { clearCache } from "../background/cache.js";

const { MSG, languages, settings: settingsStore } = globalThis.LC;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let settings;

async function send(type, payload = {}) {
  const response = await browser.runtime.sendMessage({ type, ...payload });
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

// --- Generic binding between [data-setting] inputs and storage --------------------

function readPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function inputValue(input) {
  if (input.type === "checkbox") return input.checked;
  if (input.type === "number") return Number(input.value);
  if (input.dataset.setting === "disabledSites") {
    return input.value.split("\n").map((s) => s.trim()).filter(Boolean);
  }
  return input.value.trim();
}

function showValue(input, value) {
  if (input.type === "checkbox") input.checked = Boolean(value);
  else if (input.type === "radio") input.checked = input.value === value;
  else if (Array.isArray(value)) input.value = value.join("\n");
  else input.value = value ?? "";
}

let savedTimer;
async function save(path, value) {
  const [key, nested] = path.split(".");
  const patch = nested ? { [key]: { ...settings[key], [nested]: value } } : { [key]: value };
  Object.assign(settings, patch);
  await settingsStore.saveSettings(patch);
  $("#saved").hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($("#saved").hidden = true), 1500);
}

function bindInputs() {
  for (const input of $$("[data-setting]")) {
    showValue(input, readPath(settings, input.dataset.setting));
    // Text fields save on "change" (blur/enter) to avoid writing on every keystroke.
    input.addEventListener("change", async () => {
      await save(input.dataset.setting, inputValue(input));
      onSettingChanged(input.dataset.setting);
    });
  }
}

function onSettingChanged(path) {
  if (path === "ankiEnabled") updateAnki();
  if (path === "translator") updateTranslatorRows();
  if (path === "noteTypeMode" || path === "mappedModel") updateMapping();
  if (path === "ankiUrl" || path === "libreUrl") updateGrantButtons();
}

// --- Languages and their decks -----------------------------------------------------

// Deck names from Anki, kept so the rows can be rebuilt when a language is added or removed.
let ankiDecks = [];

// One row per language: a checkbox and, when checked, its deck. At least one stays checked.
function renderLanguages() {
  const rows = languages.learnable.map(({ code, name }) => {
    const learning = settings.learning.includes(code);
    const row = document.createElement("div");
    row.className = "row";

    const label = document.createElement("label");
    label.className = "choice";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = learning;
    checkbox.disabled = learning && settings.learning.length === 1;
    if (checkbox.disabled) label.title = "At least one language stays selected.";
    checkbox.addEventListener("change", async () => {
      // Keeps the order in which languages were added; the first one wins for kanji-only text.
      const next = checkbox.checked ? [...settings.learning, code] : settings.learning.filter((other) => other !== code);
      await save("learning", next);
      renderLanguages();
    });
    label.append(checkbox, ` ${name}`);
    row.append(label);

    if (learning && settings.ankiEnabled) {
      const select = document.createElement("select");
      select.id = `deck-${code}`;
      select.title = `Deck for ${name}`;
      select.addEventListener("change", () => save(`decks.${code}`, select.value));
      row.append(select);
    }
    return row;
  });
  $("#language-rows").replaceChildren(...rows);
  fillDeckSelects(ankiDecks);
}

// A language without its own deck shows (and uses) the fallback deck from deckFor.
function fillDeckSelects(decks) {
  ankiDecks = decks;
  for (const code of settings.learning) {
    const select = $(`#deck-${code}`);
    if (select) fillSelect(select, decks, settingsStore.deckFor(settings, code));
  }
}

// The Anki settings and the decks next to the languages show only while saving to Anki is on.
function updateAnki() {
  $("#anki-settings").hidden = !settings.ankiEnabled;
  for (const row of $$(".anki-only")) row.hidden = !settings.ankiEnabled;
  renderLanguages();
  if (!settings.ankiEnabled) return;
  // Fill decks and note types quietly if Anki is already running.
  loadAnkiLists().catch(() => {
    $("#anki-status").textContent = "Anki not connected. Open Anki and click Test connection.";
  });
}

// --- Text in images -------------------------------------------------------------

// Firefox lets extensions capture a tab without a click only with <all_urls> (background/ocr.js).
const ALL_SITES = { origins: ["<all_urls>"] };
// The cache the background keeps the downloaded models in (background/ocr.js). Extension pages
// share it, since they have the same origin.
const MODEL_CACHE = "ocr-models-v2";

async function renderImageText() {
  const granted = await browser.permissions.contains(ALL_SITES);
  $("#images-permission").textContent = granted ? "Allowed" : "Not allowed yet: text in images stays off until you allow it.";
  $("#images-permission").className = granted ? "success" : "muted";
  $("#images-grant").hidden = granted;

  const rows = settings.imageTextSites.map((site) => {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      await save("imageTextSites", settings.imageTextSites.filter((other) => other !== site));
      renderImageText();
    });
    const name = document.createElement("span");
    name.textContent = site;
    const row = document.createElement("li");
    row.append(name, remove);
    return row;
  });
  if (!rows.length) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = "No sites yet.";
    rows.push(empty);
  }
  $("#images-sites").replaceChildren(...rows);
  renderModels();
}

async function renderModels() {
  let bytes = 0;
  const cache = await caches.open(MODEL_CACHE);
  for (const request of await cache.keys()) bytes += (await (await cache.match(request)).blob()).size;
  $("#images-models").textContent = bytes ? `${Math.round(bytes / 1e6)} MB` : "None yet. They download the first time a page is read.";
  $("#images-delete-models").hidden = !bytes;
}

// "https://www.example.com/a" → "example.com"; null if it isn't a hostname.
function siteFrom(input) {
  const host = input.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/^www\./, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

function bindImageText() {
  $("#images-grant").addEventListener("click", () => browser.permissions.request(ALL_SITES).then(renderImageText));
  $("#images-add").addEventListener("submit", async (event) => {
    event.preventDefault();
    const site = siteFrom($("#images-new-site").value);
    if (!site) {
      $("#images-new-site").setCustomValidity("Enter a site such as example.com");
      $("#images-new-site").reportValidity();
      return;
    }
    $("#images-new-site").setCustomValidity("");
    // Asked first, while this still counts as the user's click.
    const permission = browser.permissions.request(ALL_SITES);
    if (!settings.imageTextSites.includes(site)) await save("imageTextSites", [...settings.imageTextSites, site]);
    $("#images-new-site").value = "";
    await permission;
    renderImageText();
  });
  $("#images-new-site").addEventListener("input", () => $("#images-new-site").setCustomValidity(""));
  $("#images-delete-models").addEventListener("click", async () => {
    await caches.delete(MODEL_CACHE);
    renderModels();
  });
}

// --- Navigation --------------------------------------------------------------------

// Highlights the section being read in the navigation on the left.
function bindNavigation() {
  const links = new Map($$(".toc a").map((link) => [link.getAttribute("href").slice(1), link]));
  const visible = new Set();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) entry.isIntersecting ? visible.add(entry.target.id) : visible.delete(entry.target.id);
    const current = $$("main section").find((section) => visible.has(section.id) && links.has(section.id));
    for (const [id, link] of links) link.setAttribute("aria-current", String(id === current?.id));
  }, { rootMargin: "0px 0px -60% 0px" });
  for (const section of $$("main section[id]")) observer.observe(section);
}

// --- Translator -------------------------------------------------------------------

function updateTranslatorRows() {
  for (const row of $$("[data-show-for]")) row.hidden = row.dataset.showFor !== settings.translator;
}

// Host permissions for user-provided URLs. permissions.request must run directly in a click handler.
function originPattern(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return `${protocol}//${hostname}/*`;
  } catch {
    return null;
  }
}

async function updateGrantButtons() {
  for (const button of $$(".grant")) {
    const origin = originPattern(settings[button.dataset.for]);
    button.hidden = !origin || (await browser.permissions.contains({ origins: [origin] }));
  }
}

function bindGrantButtons() {
  for (const button of $$(".grant")) {
    button.addEventListener("click", () => {
      const origin = originPattern(settings[button.dataset.for]);
      if (origin) browser.permissions.request({ origins: [origin] }).then(updateGrantButtons);
    });
  }
}

// --- Anki -------------------------------------------------------------------------

async function testAnki() {
  const status = $("#anki-status");
  status.className = "muted";
  status.textContent = "Connecting… (check Anki for a permission dialog)";
  try {
    const { version } = await send(MSG.ANKI_STATUS);
    status.className = "success";
    status.textContent = `Connected (AnkiConnect v${version})`;
    await loadAnkiLists();
  } catch (error) {
    status.className = "error";
    status.textContent = error.message;
  }
}

function fillSelect(select, values, current, { placeholder } = {}) {
  const list = current && !values.includes(current) ? [current, ...values] : values;
  select.replaceChildren(...(placeholder ? [new Option(placeholder, "")] : []), ...list.map((v) => new Option(v, v)));
  select.value = current ?? "";
}

async function loadAnkiLists() {
  const [decks, models] = await Promise.all([send(MSG.ANKI_DECKS), send(MSG.ANKI_MODELS)]);
  fillDeckSelects(decks);
  fillSelect($("#mappedModel"), models, settings.mappedModel, { placeholder: "Choose a note type…" });
  await updateMapping();
}

async function updateMapping() {
  const mapped = settings.noteTypeMode === "mapped";
  $("#mapping").hidden = !mapped;
  if (!mapped || !settings.mappedModel) return $("#field-map").replaceChildren();

  let modelFields = [];
  try {
    modelFields = await send(MSG.ANKI_MODEL_FIELDS, { modelName: settings.mappedModel });
  } catch {
    // Anki not reachable; keep the saved mapping visible.
    modelFields = Object.values(settings.fieldMap).filter(Boolean);
  }

  const rows = NOTE_FIELDS.map((lcField) => {
    const select = document.createElement("select");
    fillSelect(select, [...new Set(modelFields)], settings.fieldMap[lcField] ?? "", { placeholder: "— not saved —" });
    select.addEventListener("change", () => save("fieldMap", { ...settings.fieldMap, [lcField]: select.value }));
    const row = document.createElement("tr");
    const label = document.createElement("td");
    label.textContent = lcField;
    const cell = document.createElement("td");
    cell.append(select);
    row.append(label, cell);
    return row;
  });
  $("#field-map").replaceChildren(...rows);
}

// --- Init -------------------------------------------------------------------------

async function init() {
  settings = await settingsStore.getSettings();
  bindInputs();
  bindGrantButtons();
  updateTranslatorRows();
  updateGrantButtons();
  updateMapping();
  updateAnki();
  bindImageText();
  renderImageText();
  bindNavigation();

  $("#test-anki").addEventListener("click", testAnki);
  $("#clear-cache").addEventListener("click", async () => {
    await clearCache();
    $("#cache-status").textContent = "Cache cleared.";
  });
}

// Switches start animating only after the page has painted its settings (.ready in page.css).
init().finally(() => requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add("ready"))));
