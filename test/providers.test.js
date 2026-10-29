import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripHtml } from "../src/background/providers/http.js";
import { parse as parseMyMemory } from "../src/background/providers/mymemory.js";
import { parse as parseWiktionary } from "../src/background/providers/wiktionary.js";
import { parse as parseFreeDictionary } from "../src/background/providers/freedictionary.js";
import { parse as parseTatoeba } from "../src/background/providers/tatoeba.js";
import { parse as parseJisho } from "../src/background/providers/jisho.js";
import { isPhrase, lookupDetails, lookupTranslation, resolveSourceLang } from "../src/background/lookup.js";
import "../src/shared/settings.js";
import "../src/shared/furigana.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url)));
const { DEFAULTS } = globalThis.LC.settings;

test("stripHtml removes tags and decodes entities", () => {
  assert.equal(stripHtml('<a href="/x">house</a>, <b>big</b> &amp; &#x27;old&#39; &nbsp;'), "house, big & 'old'");
});

test("MyMemory", () => {
  assert.equal(parseMyMemory(fixture("mymemory")), "Haus");
  const fuzzy = {
    responseStatus: 200,
    responseData: { translatedText: "А. Жилая площадь", match: 0.88 },
    matches: [
      { segment: "A. Dwelling space", translation: "А. Жилая площадь", "created-by": "Public_Corpora", match: 0.88 },
      { segment: "dwelling space", translation: "жилая площадь", "created-by": "MT!", match: 0.85 },
    ],
  };
  assert.equal(parseMyMemory(fuzzy), "жилая площадь");
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

test("resolveSourceLang order: card, writing system, detection, letters, page language", async () => {
  const detect = async () => ({ isReliable: true, languages: [{ language: "fr", percentage: 99 }] });
  const unreliable = async () => ({ isReliable: false, languages: [{ language: "fr", percentage: 40 }] });
  assert.equal(await resolveSourceLang({ text: "x", sourceLang: "tr" }, detect), "tr");
  assert.equal(await resolveSourceLang({ text: "x", sourceLang: "auto" }, detect), "fr");
  assert.equal(await resolveSourceLang({ text: "x", pageLang: "sq-AL" }, unreliable), "sq");
  assert.equal(await resolveSourceLang({ text: "x" }, unreliable), "en");
});

test("resolveSourceLang recognizes writing systems before detection", async () => {
  const detect = async () => ({ isReliable: true, languages: [{ language: "zh", percentage: 99 }] });
  assert.equal(await resolveSourceLang({ text: "дом" }, detect), "ru");
  assert.equal(await resolveSourceLang({ text: "집" }, detect), "ko");
  assert.equal(await resolveSourceLang({ text: "ありがとう" }, detect), "ja");
  assert.equal(await resolveSourceLang({ text: "家" }, detect), "ja");
});

test("resolveSourceLang skips unsupported detections and falls back to telltale letters", async () => {
  const detect = async () => ({ isReliable: true, languages: [{ language: "es" }, { language: "tr" }] });
  const unsure = async () => ({ isReliable: false, languages: [] });
  assert.equal(await resolveSourceLang({ text: "x" }, detect), "tr");
  assert.equal(await resolveSourceLang({ text: "patëllxhan", pageLang: "en" }, unsure), "sq");
  assert.equal(await resolveSourceLang({ text: "değil", pageLang: "en" }, unsure), "tr");
  // German is not supported, so its letters mean nothing.
  assert.equal(await resolveSourceLang({ text: "Straße", pageLang: "en" }, unsure), "en");
  assert.equal(await resolveSourceLang({ text: "très", pageLang: "en" }, unsure), "fr");
});

test("resolveSourceLang prefers the subtitle track language", async () => {
  assert.equal(await resolveSourceLang({ text: "x", contentLang: "ja" }), "ja");
  assert.equal(await resolveSourceLang({ text: "x", contentLang: "ja", sourceLang: "ko" }), "ko");
  // Unsupported track languages fall back to the other rules.
  assert.equal(await resolveSourceLang({ text: "x", contentLang: "sw", pageLang: "ko" }), "ko");
});

test("lookupDetails merges providers and tolerates failures", async () => {
  const responses = {
    "api.dictionaryapi.dev": fixture("freedictionary"),
    "en.wiktionary.org": { en: [{ partOfSpeech: "Noun", definitions: [{ definition: "a building" }] }] },
  };
  const fetch = async (url) => {
    const host = new URL(url).hostname;
    assert.notEqual(host, "api.mymemory.translated.net", "should not call the translator");
    if (host === "api.tatoeba.org") return { ok: false, status: 500 };
    return { ok: true, status: 200, json: async () => responses[host] };
  };
  const cache = new Map();
  const ctx = { fetch, cache: { get: async (k) => cache.get(k), set: async (k, v) => cache.set(k, v) } };

  const result = await lookupDetails({ text: "house", sourceLang: "en" }, DEFAULTS, ctx);
  assert.equal(result.ipa, "/hʌʊs/");
  // Free Dictionary comes first, so its definitions win over Wiktionary's.
  assert.notEqual(result.definitions[0].text, "a building");
  assert.ok(result.definitions.length <= DEFAULTS.maxDefinitions);
  assert.deepEqual(result.errors, ["tatoeba: HTTP 500"]);
  // Results with errors are not cached.
  assert.equal(cache.size, 0);
});

test("lookupTranslation translates the word and sentence and caches the word", async () => {
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    assert.match(url, /mymemory/, "should only call the translator");
    return { ok: true, status: 200, json: async () => fixture("mymemory") };
  };
  const cache = new Map();
  const ctx = { fetch, cache: { get: async (k) => cache.get(k), set: async (k, v) => cache.set(k, v) } };
  const req = { text: "maison", sentence: "La maison est grande.", sourceLang: "fr" };

  const result = await lookupTranslation(req, DEFAULTS, ctx);
  assert.equal(result.targetLang, "en");
  assert.equal(result.translation, "Haus");
  assert.equal(result.sentenceTranslation, "Haus");
  assert.deepEqual(result.errors, []);
  assert.deepEqual([...cache.values()], [{ translation: "Haus" }]);

  await lookupTranslation(req, DEFAULTS, ctx);
  assert.equal(urls.length, 3, "the word comes from the cache the second time");
});

test("lookupTranslation skips translation for English words", async () => {
  const fetch = async () => assert.fail("should not call the translator");
  const result = await lookupTranslation({ text: "house", sourceLang: "en" }, DEFAULTS, { fetch });
  assert.equal(result.translation, "");
  assert.deepEqual(result.errors, []);
});

test("lookupDetails skips phrases", async () => {
  const fetch = async () => assert.fail("should not call any provider");
  const result = await lookupDetails({ text: "The house is very big today.", sourceLang: "en" }, DEFAULTS, { fetch });
  assert.deepEqual(result, { ipa: "", reading: "", audioUrl: "", definitions: [], examples: [], errors: [] });
});

test("isPhrase counts words, or characters for languages without spaces", () => {
  assert.equal(isPhrase("ice cream", "en"), false);
  assert.equal(isPhrase("I like ice cream", "en"), true);
  assert.equal(isPhrase("ありがとうございます", "ja"), false);
  assert.equal(isPhrase("今日はとても暑いですね、本当に", "ja"), true);
});

test("deckFor uses the language's deck, or the fallback deck", () => {
  const { deckFor } = globalThis.LC.settings;
  const settings = { ...DEFAULTS, deck: "English", decks: { sq: "Albanian", ja: "" } };
  assert.equal(deckFor(settings, "sq"), "Albanian");
  assert.equal(deckFor(settings, "ja"), "English");
  assert.equal(deckFor(settings, "en"), "English");
});

test("Jisho returns the reading of exactly this word", () => {
  const result = parseJisho(fixture("jisho"), "食べ物");
  assert.equal(result.reading, "たべもの");
  assert.deepEqual(result.definitions[0], { pos: "Noun", text: "food" });
  // A longer word in the results must not lend its reading.
  assert.deepEqual(parseJisho(fixture("jisho"), "食べ"), { reading: "", definitions: [] });
  // Kana-only words need no reading.
  const kana = { data: [{ japanese: [{ reading: "ありがとう" }], senses: [{ english_definitions: ["thank you"] }] }] };
  assert.equal(parseJisho(kana, "ありがとう").reading, "");
});

test("furigana goes over the kanji only", () => {
  const { segments } = globalThis.LC.furigana;
  assert.deepEqual(segments("食べ物", "たべもの"), [{ text: "食", rt: "た" }, { text: "べ" }, { text: "物", rt: "もの" }]);
  assert.deepEqual(segments("日本語", "にほんご"), [{ text: "日本語", rt: "にほんご" }]);
  assert.deepEqual(segments("人々", "ひとびと"), [{ text: "人々", rt: "ひとびと" }]);
  // Katakana in the word matches hiragana in the reading.
  assert.deepEqual(segments("お茶", "おちゃ"), [{ text: "お" }, { text: "茶", rt: "ちゃ" }]);
  assert.deepEqual(segments("ありがとう", ""), [{ text: "ありがとう" }]);
  // A reading that does not fit goes over the whole word.
  assert.deepEqual(segments("食べ物", "くだもの"), [{ text: "食べ物", rt: "くだもの" }]);
});
