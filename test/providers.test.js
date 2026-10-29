import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripHtml } from "../src/background/providers/http.js";
import { parse as parseMyMemory } from "../src/background/providers/mymemory.js";
import { parse as parseWiktionary } from "../src/background/providers/wiktionary.js";
import { parse as parseFreeDictionary } from "../src/background/providers/freedictionary.js";
import { parse as parseTatoeba } from "../src/background/providers/tatoeba.js";
import { parse as parseJisho } from "../src/background/providers/jisho.js";
import wiktionary from "../src/background/providers/wiktionary.js";
import { isPhrase, lookupDetails, lookupTranslation, resolveSourceLang, translateLine } from "../src/background/lookup.js";
import { createFrequency, frequencyLabel } from "../src/background/frequency.js";
import "../src/shared/settings.js";
import "../src/shared/furigana.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url)));
const { DEFAULTS } = globalThis.LC.settings;

test("stripHtml drops inline style blocks", () => {
  assert.equal(stripHtml("<style>.mw-parser-output .defdate{font-size:smaller}</style>a cat"), "a cat");
});

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
  assert.deepEqual(parseWiktionary(null, "de"), { definitions: [], examples: [], base: null });
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
  assert.deepEqual(result, { ipa: "", reading: "", audioUrl: "", definitions: [], examples: [], base: null, frequency: null, errors: [] });
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
  assert.deepEqual(parseJisho(fixture("jisho"), "食べ"), { reading: "", definitions: [], frequency: null, base: null });
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

test("Wiktionary finds the base form of an inflected word", () => {
  const { definitions, base } = parseWiktionary(fixture("wiktionary-courait"), "fr");
  assert.deepEqual(base, { word: "courir", formOf: "third-person singular imperfect indicative of courir" });
  assert.equal(definitions[0].formOf, "courir");
  // Romanizations link to another spelling, not a base form.
  const romaji = {
    ja: [{ partOfSpeech: "Romanization", definitions: [{ definition: 'Rōmaji transcription of <span class="form-of-definition-link"><i><a title="いしん">いしん</a></i></span>' }] }],
  };
  assert.equal(parseWiktionary(romaji, "ja").base, null);
});

test("Wiktionary shows the base word's definitions for an inflected form", async () => {
  const urls = [];
  const pages = {
    courait: fixture("wiktionary-courait"),
    courir: { fr: [{ partOfSpeech: "Verb", definitions: [{ definition: "to run" }] }] },
  };
  const fetch = async (url) => {
    urls.push(decodeURIComponent(url.split("/").pop()));
    return { ok: true, status: 200, json: async () => pages[urls.at(-1)] };
  };
  const result = await wiktionary.lookup({ text: "courait", src: "fr" }, DEFAULTS, { fetch });
  assert.deepEqual(urls, ["courait", "courir"]);
  assert.deepEqual(result.definitions, [{ pos: "Verb", text: "to run" }]);
  assert.equal(result.base.word, "courir");
});

test("Jisho finds the dictionary form of a conjugated word, with its JLPT level", () => {
  const result = parseJisho(fixture("jisho-tabeta"), "食べた");
  assert.deepEqual(result.base, { word: "食べる", reading: "たべる", formOf: "conjugated form of 食べる" });
  assert.equal(result.reading, "たべた");
  assert.equal(result.definitions[0].text, "to eat");
  assert.deepEqual(result.frequency, { label: "JLPT N5", rank: null });
  // Exact matches report their frequency too; nouns are never treated as conjugated.
  assert.deepEqual(parseJisho(fixture("jisho-tabeta"), "食べる").frequency, { label: "JLPT N5", rank: null });
  const common = { data: [{ is_common: true, jlpt: [], japanese: [{ word: "猫", reading: "ねこ" }], senses: [] }] };
  assert.deepEqual(parseJisho(common, "猫").frequency, { label: "Common", rank: null });
  assert.equal(parseJisho(common, "猫だ").base, null);
});

test("frequency ranks words from the bundled lists", async () => {
  const loads = [];
  const frequency = createFrequency(async (lang) => {
    loads.push(lang);
    return "de\nje\ncheval\n";
  });
  assert.equal(await frequency.rank("fr", "Cheval"), 3);
  assert.equal(await frequency.rank("fr", "chevaux"), Infinity);
  assert.equal(await frequency.rank("ja", "猫"), null);
  assert.equal(await frequency.rank("ko", "먹었다"), null);
  assert.deepEqual(loads, ["fr", "ko"], "each list is loaded once");

  assert.deepEqual(frequencyLabel(1), { label: "Top 1k", rank: 1 });
  assert.deepEqual(frequencyLabel(1583), { label: "Top 2k", rank: 1583 });
  assert.deepEqual(frequencyLabel(20000), { label: "Top 20k", rank: 20000 });
  assert.deepEqual(frequencyLabel(Infinity), { label: "Rare", rank: null });
  assert.equal(frequencyLabel(null), null);
});

test("lookupDetails rates the base form's frequency and respects the setting", async () => {
  const pages = {
    chevaux: { fr: [{ partOfSpeech: "Noun", definitions: [{ definition: 'plural of <span class="form-of-definition-link"><i><a title="cheval">cheval</a></i></span>' }] }] },
    cheval: { fr: [{ partOfSpeech: "Noun", definitions: [{ definition: "horse" }] }] },
  };
  const fetch = async (url) => {
    if (!url.includes("wiktionary")) return { ok: true, status: 200, json: async () => ({ data: [] }) };
    return { ok: true, status: 200, json: async () => pages[decodeURIComponent(url.split("/").pop())] };
  };
  const ranks = { cheval: 1069 };
  const ctx = { fetch, frequency: { rank: async (lang, word) => (lang === "fr" ? (ranks[word] ?? Infinity) : null) } };

  const result = await lookupDetails({ text: "chevaux", sourceLang: "fr" }, DEFAULTS, ctx);
  assert.equal(result.base.word, "cheval");
  assert.deepEqual(result.definitions, [{ pos: "Noun", text: "horse" }]);
  assert.deepEqual(result.frequency, { label: "Top 2k", rank: 1069 });

  const off = { ...DEFAULTS, providers: { ...DEFAULTS.providers, frequency: false } };
  assert.equal((await lookupDetails({ text: "chevaux", sourceLang: "fr" }, off, ctx)).frequency, null);
});

test("translateLine translates a subtitle line without caching it", async () => {
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => fixture("mymemory") };
  };
  const cache = { get: async () => assert.fail("no cache reads"), set: async () => assert.fail("no cache writes") };
  const result = await translateLine({ text: "Je cours vite.", contentLang: "fr" }, DEFAULTS, { fetch, cache });
  assert.deepEqual(result, { translation: "Haus", sourceLang: "fr" });
  assert.equal(urls.length, 1);
  // English subtitles are not translated into English.
  assert.deepEqual(await translateLine({ text: "Hello there.", contentLang: "en" }, DEFAULTS, { fetch, cache }), { translation: "", sourceLang: "en" });
  assert.equal(urls.length, 1);
});
