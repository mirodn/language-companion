import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripHtml } from "../src/background/providers/http.js";
import { parse as parseMyMemory } from "../src/background/providers/mymemory.js";
import { parse as parseWiktionary } from "../src/background/providers/wiktionary.js";
import { parse as parseFreeDictionary } from "../src/background/providers/freedictionary.js";
import { parse as parseTatoeba } from "../src/background/providers/tatoeba.js";
import { lookup, resolveSourceLang } from "../src/background/lookup.js";
import "../src/shared/settings.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url)));
const { DEFAULTS } = globalThis.LC.settings;

test("stripHtml removes tags and decodes entities", () => {
  assert.equal(stripHtml('<a href="/x">house</a>, <b>big</b> &amp; &#x27;old&#39; &nbsp;'), "house, big & 'old'");
});

test("MyMemory", () => {
  assert.equal(parseMyMemory(fixture("mymemory")), "Haus");
  assert.throws(() => parseMyMemory({ responseStatus: 403, responseDetails: "INVALID LANGUAGE PAIR" }), /INVALID LANGUAGE PAIR/);
});

test("Wiktionary picks the source language section", () => {
  const { definitions, examples } = parseWiktionary(fixture("wiktionary"), "de");
  assert.deepEqual(definitions[0], { pos: "Noun", text: "house, building" });
  assert.deepEqual(examples[0], {
    text: "In dem Haus haben wir mal gewohnt.",
    translation: "We used to live in that house.",
    source: "Wiktionary",
  });
  assert.deepEqual(parseWiktionary(null, "de"), { definitions: [], examples: [] });
});

test("Free Dictionary returns IPA and audio", () => {
  const result = parseFreeDictionary(fixture("freedictionary"));
  assert.equal(result.ipa, "/hʌʊs/");
  assert.match(result.audioUrl, /^https:\/\/.*\.mp3$/);
  assert.ok(result.definitions.length > 0);
  assert.equal(parseFreeDictionary(null).definitions.length, 0);
});

test("Tatoeba prefers direct translations", () => {
  const examples = parseTatoeba(fixture("tatoeba"));
  assert.deepEqual(examples[0], { text: "Which house?", translation: "Welches Haus?", source: "Tatoeba" });
  assert.equal(examples[2].translation, "Ich plane Häuser.");
});

test("resolveSourceLang order: request, setting, detection, page language", async () => {
  const detect = async () => ({ isReliable: true, languages: [{ language: "fr", percentage: 99 }] });
  const unreliable = async () => ({ isReliable: false, languages: [{ language: "fr", percentage: 40 }] });
  assert.equal(await resolveSourceLang({ sourceLang: "es" }, { sourceLang: "de" }, detect), "es");
  assert.equal(await resolveSourceLang({}, { sourceLang: "de" }, detect), "de");
  assert.equal(await resolveSourceLang({ text: "x" }, { sourceLang: "auto" }, detect), "fr");
  assert.equal(await resolveSourceLang({ text: "x", pageLang: "it-IT" }, { sourceLang: "auto" }, unreliable), "it");
});

test("resolveSourceLang prefers the subtitle track language over settings", async () => {
  assert.equal(await resolveSourceLang({ contentLang: "ja" }, { sourceLang: "de" }), "ja");
  assert.equal(await resolveSourceLang({ contentLang: "ja", sourceLang: "ko" }, { sourceLang: "de" }), "ko");
  // Unsupported track languages fall back to the setting.
  assert.equal(await resolveSourceLang({ contentLang: "sw" }, { sourceLang: "de" }), "de");
});

test("lookup merges providers and tolerates failures", async () => {
  const responses = {
    "api.mymemory.translated.net": fixture("mymemory"),
    "api.dictionaryapi.dev": fixture("freedictionary"),
    "en.wiktionary.org": { en: [{ partOfSpeech: "Noun", definitions: [{ definition: "a building" }] }] },
  };
  const fetch = async (url) => {
    const host = new URL(url).hostname;
    if (host === "api.tatoeba.org") return { ok: false, status: 500 };
    return { ok: true, status: 200, json: async () => responses[host] };
  };
  const cache = new Map();
  const ctx = { fetch, cache: { get: async (k) => cache.get(k), set: async (k, v) => cache.set(k, v) } };

  const result = await lookup(
    { text: "house", sentence: "The house is big.", sourceLang: "en" },
    { ...DEFAULTS, targetLang: "de" },
    ctx,
  );
  assert.equal(result.translation, "Haus");
  assert.equal(result.sentenceTranslation, "Haus");
  assert.equal(result.ipa, "/hʌʊs/");
  // Free Dictionary comes first, so its definitions win over Wiktionary's.
  assert.notEqual(result.definitions[0].text, "a building");
  assert.ok(result.definitions.length <= DEFAULTS.maxDefinitions);
  assert.deepEqual(result.errors, ["tatoeba: HTTP 500"]);
  // Results with errors are not cached.
  assert.equal(cache.size, 0);
});

test("lookup skips translation when source and target are the same", async () => {
  const fetch = async (url) => {
    assert.ok(!url.includes("mymemory"), "should not call the translator");
    return { ok: true, status: 404, json: async () => null };
  };
  const result = await lookup({ text: "house", sourceLang: "en" }, { ...DEFAULTS, targetLang: "en" }, { fetch });
  assert.equal(result.translation, "");
  assert.deepEqual(result.errors, []);
});
