import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AnkiError } from "../src/background/anki.js";
import { flushQueue, loadLog, logAdded, queueNote, removeEntry } from "../src/background/word-log.js";
import { startOfWeek, summarize } from "../src/stats/summary.js";

// In-memory stand-in for browser.storage.local.
let store;
globalThis.browser = {
  storage: {
    local: {
      get: async (key) => ({ [key]: structuredClone(store[key]) }),
      set: async (items) => Object.assign(store, structuredClone(items)),
    },
  },
};
beforeEach(() => (store = {}));

const card = (word, pageUrl = "https://www.example.org/article") => ({ word, sourceLang: "fr", pageUrl });
const note = (word) => ({ deckName: "French", fields: { Word: word } });

test("logAdded and queueNote record the word, deck and site", async () => {
  await logAdded(card("maison"), note("maison"));
  await queueNote(card("chat", "https://www.youtube.com/watch?v=x"), note("chat"));
  const [added, queued] = await loadLog();
  assert.deepEqual(
    { word: added.word, lang: added.lang, deck: added.deck, host: added.host, status: added.status, note: added.note },
    { word: "maison", lang: "fr", deck: "French", host: "example.org", status: "added", note: undefined },
  );
  assert.equal(queued.host, "youtube.com");
  assert.equal(queued.status, "queued");
  assert.deepEqual(queued.note, note("chat"));

  await removeEntry(added.id);
  assert.deepEqual((await loadLog()).map((entry) => entry.word), ["chat"]);
});

test("flushQueue adds queued notes, drops duplicates and keeps failures", async () => {
  for (const word of ["un", "deux", "trois"]) await queueNote(card(word), note(word));
  const sent = [];
  const result = await flushQueue(async (n) => {
    sent.push(n.fields.Word);
    if (n.fields.Word === "deux") throw new AnkiError("cannot create note because it is a duplicate");
    if (n.fields.Word === "trois") throw new AnkiError("deck was not found");
    return 1;
  });

  assert.deepEqual(sent, ["un", "deux", "trois"]);
  assert.deepEqual(result, { added: 1, remaining: 1, unreachable: false });
  const log = await loadLog();
  assert.deepEqual(log.map(({ word, status }) => [word, status]), [["un", "added"], ["trois", "queued"]]);
  assert.equal("note" in log[0], false);
  assert.equal(log[1].error, "deck was not found");
});

test("flushQueue stops when Anki is unreachable", async () => {
  for (const word of ["un", "deux"]) await queueNote(card(word), note(word));
  let calls = 0;
  const result = await flushQueue(async () => {
    calls += 1;
    throw new AnkiError("Cannot reach Anki.", { unreachable: true });
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { added: 0, remaining: 2, unreachable: true });
});

test("summarize counts weeks, languages, sites and the streak", () => {
  // Wednesday, 29 October 2025, local time.
  const now = new Date(2025, 9, 29, 15).getTime();
  const at = (month, day) => new Date(2025, month, day, 12).getTime();
  const entries = [
    { at: at(9, 29), lang: "fr", host: "youtube.com", status: "added" },
    { at: at(9, 28), lang: "fr", host: "lemonde.fr", status: "added" },
    { at: at(9, 27), lang: "ja", host: "youtube.com", status: "queued" },
    // Gap on the 26th ends the streak.
    { at: at(9, 25), lang: "fr", host: "youtube.com", status: "added" },
    { at: at(8, 1), lang: "ru", host: "", status: "added" },
  ];
  const summary = summarize(entries, now, { weeks: 4 });

  assert.equal(summary.total, 5);
  assert.equal(summary.thisWeek, 3);
  assert.equal(summary.streak, 3);
  assert.deepEqual(summary.weeks.map((week) => week.count), [0, 0, 1, 3]);
  assert.equal(summary.weeks[3].start, startOfWeek(now));
  assert.equal(new Date(summary.weeks[3].start).getDay(), 1);
  assert.deepEqual(summary.languages, [{ value: "fr", count: 3 }, { value: "ja", count: 1 }, { value: "ru", count: 1 }]);
  assert.deepEqual(summary.sources, [{ value: "youtube.com", count: 3 }, { value: "lemonde.fr", count: 1 }]);
  assert.equal(summary.queued.length, 1);
});

test("the streak still counts yesterday until a word is saved today", () => {
  const now = new Date(2025, 9, 29, 9).getTime();
  const entries = [{ at: new Date(2025, 9, 28, 20).getTime() }, { at: new Date(2025, 9, 27, 20).getTime() }];
  assert.equal(summarize(entries, now).streak, 2);
  assert.equal(summarize([], now).streak, 0);
});
