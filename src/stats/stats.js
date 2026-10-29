import { STORAGE_KEY, loadLog } from "../background/word-log.js";
import { summarize } from "./summary.js";

const { MSG, languages } = globalThis.LC;

const $ = (selector) => document.querySelector(selector);

const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

async function send(type, payload = {}) {
  const response = await browser.runtime.sendMessage({ type, ...payload });
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

// Minimal element builder: h("td", { class: "x" }, child, "text").
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "class") el.className = value;
    else el.setAttribute(key, value);
  }
  el.append(...children);
  return el;
}

// --- Waiting for Anki ---------------------------------------------------------------

function renderQueue(queued) {
  $("#queue").hidden = queued.length === 0;
  const rows = queued.map((entry) =>
    h(
      "tr",
      {},
      h("td", {}, entry.word, ...(entry.error ? [h("div", { class: "error small" }, entry.error)] : [])),
      h("td", {}, entry.deck ?? ""),
      h("td", { class: "muted" }, dateTime.format(entry.at)),
      h("td", {}, h("button", { type: "button", onClick: () => send(MSG.LOG_REMOVE, { id: entry.id }) }, "Remove")),
    ),
  );
  $("#queue-rows").replaceChildren(...rows);
}

async function flush() {
  const status = $("#queue-status");
  $("#flush").disabled = true;
  status.className = "muted";
  status.textContent = "Adding…";
  try {
    const { added, remaining, unreachable } = await send(MSG.QUEUE_FLUSH);
    if (unreachable) {
      status.className = "error";
      status.textContent = "Anki is still closed.";
    } else {
      status.textContent = remaining ? `Added ${added}, ${remaining} could not be added.` : `Added ${added}.`;
    }
  } catch (error) {
    status.className = "error";
    status.textContent = error.message;
  } finally {
    $("#flush").disabled = false;
  }
}

// --- Stats --------------------------------------------------------------------------

function renderWeeks(weeks) {
  const max = Math.max(1, ...weeks.map((week) => week.count));
  const columns = weeks.map(({ start, count }) =>
    h(
      "div",
      { class: "week", title: `Week of ${shortDate.format(start)}: ${count}` },
      h("span", { class: "count" }, count ? String(count) : ""),
      h("div", { class: "bar", style: `height: ${(count / max) * 100}%` }),
      h("span", { class: "date" }, shortDate.format(start)),
    ),
  );
  $("#weeks").replaceChildren(...columns);
  $("#weeks").setAttribute("aria-label", weeks.map(({ start, count }) => `${shortDate.format(start)}: ${count}`).join(", "));
}

function renderBars(list, items, label) {
  const max = Math.max(1, ...items.map((item) => item.count));
  const rows = items.map(({ value, count }) =>
    h(
      "li",
      {},
      h("span", { class: "name", title: label(value) }, label(value)),
      h("span", { class: "count" }, String(count)),
      h("div", { class: "track" }, h("div", { class: "fill", style: `width: ${(count / max) * 100}%` })),
    ),
  );
  list.replaceChildren(...rows);
}

async function render() {
  const summary = summarize(await loadLog());
  renderQueue(summary.queued);
  $("#empty").hidden = summary.total > 0;
  $("#stats").hidden = summary.total === 0;
  if (!summary.total) return;

  $("#this-week").textContent = summary.thisWeek;
  $("#streak").textContent = summary.streak;
  $("#total").textContent = summary.total;
  renderWeeks(summary.weeks);
  renderBars($("#languages"), summary.languages, (code) => languages.name(code));
  renderBars($("#sources"), summary.sources, (host) => host);
}

$("#flush").addEventListener("click", flush);
browser.storage.onChanged.addListener((changes, area) => area === "local" && changes[STORAGE_KEY] && render());
render();
