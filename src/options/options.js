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
  if (path === "translator") updateTranslatorRows();
  if (path === "noteTypeMode" || path === "mappedModel") updateMapping();
  if (path === "ankiUrl" || path === "libreUrl") updateGrantButtons();
}

// --- Decks per language ----------------------------------------------------------

const deckLanguages = () => languages.list.filter((lang) => lang.code !== languages.target);

// A language without its own deck shows (and uses) the fallback deck from deckFor.
function createDeckRows() {
  const rows = deckLanguages().map((lang) => {
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("label");
    label.htmlFor = `deck-${lang.code}`;
    label.textContent = lang.name;
    const select = document.createElement("select");
    select.id = `deck-${lang.code}`;
    select.addEventListener("change", () => save(`decks.${lang.code}`, select.value));
    row.append(label, select);
    return row;
  });
  $("#deck-rows").replaceChildren(...rows);
}

function fillDeckSelects(decks) {
  for (const lang of deckLanguages()) {
    fillSelect($(`#deck-${lang.code}`), decks, settingsStore.deckFor(settings, lang.code));
  }
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
  createDeckRows();
  fillDeckSelects([]);
  bindInputs();
  bindGrantButtons();
  updateTranslatorRows();
  updateGrantButtons();
  updateMapping();

  $("#test-anki").addEventListener("click", testAnki);
  $("#clear-cache").addEventListener("click", async () => {
    await clearCache();
    $("#cache-status").textContent = "Cache cleared.";
  });

  // Fill decks and note types quietly if Anki is already running.
  loadAnkiLists().catch(() => {
    $("#anki-status").textContent = "Anki not connected. Open Anki and click Test connection.";
  });
}

init();
