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
import { stripParticle, verbCandidates } from "../src/background/korean.js";
import cedict, { parse as parseCedict } from "../src/background/providers/cedict.js";
import kanjidic, { parseFile as parseKanjidic } from "../src/background/providers/kanjidic.js";
import { isPhrase, lookupDetails, lookupTranslation, resolveSourceLang } from "../src/background/lookup.js";
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

test("resolveSourceLang order: card, writing system, detection, page language", async () => {
  const detect = async () => ({ isReliable: true, languages: [{ language: "ko", percentage: 99 }] });
  const unreliable = async () => ({ isReliable: false, languages: [{ language: "ko", percentage: 40 }] });
  assert.equal(await resolveSourceLang({ text: "x", sourceLang: "zh" }, detect), "zh");
  assert.equal(await resolveSourceLang({ text: "x", sourceLang: "auto" }, detect), "ko");
  assert.equal(await resolveSourceLang({ text: "x", pageLang: "ja-JP" }, unreliable), "ja");
  assert.equal(await resolveSourceLang({ text: "x" }, unreliable), "en");
});

test("resolveSourceLang recognizes writing systems before detection", async () => {
  const detect = async () => ({ isReliable: true, languages: [{ language: "zh", percentage: 99 }] });
  assert.equal(await resolveSourceLang({ text: "집" }, detect, ["ja"]), "ko");
  assert.equal(await resolveSourceLang({ text: "ありがとう" }, detect, ["zh"]), "ja");
  // A kanji word in a sentence with kana is Japanese.
  assert.equal(await resolveSourceLang({ text: "学校", sentence: "学校に行きます。" }, detect, ["zh"]), "ja");
});

test("resolveSourceLang decides Han characters by the user's languages", async () => {
  const detect = async () => ({ isReliable: true, languages: [{ language: "zh", percentage: 99 }] });
  const unsure = async () => ({ isReliable: false, languages: [] });
  assert.equal(await resolveSourceLang({ text: "学校" }, detect, ["ja"]), "ja");
  assert.equal(await resolveSourceLang({ text: "学校" }, unsure, ["ko", "zh"]), "zh");
  // Learning both: detection, then the page language, then the first one added.
  assert.equal(await resolveSourceLang({ text: "学校" }, detect, ["ja", "zh"]), "zh");
  assert.equal(await resolveSourceLang({ text: "学校", pageLang: "ja" }, unsure, ["zh", "ja"]), "ja");
  assert.equal(await resolveSourceLang({ text: "学校" }, unsure, ["zh", "ja"]), "zh");
  const english = async () => ({ isReliable: true, languages: [{ language: "en", percentage: 99 }] });
  assert.equal(await resolveSourceLang({ text: "学校", sentence: "The word 学校 means school." }, english, ["zh", "ja"]), "zh");
  // Learning neither (only Korean): detection, otherwise Japanese.
  assert.equal(await resolveSourceLang({ text: "学校" }, unsure, ["ko"]), "ja");
});

test("resolveSourceLang skips unsupported detections and track languages", async () => {
  const detect = async () => ({ isReliable: true, languages: [{ language: "fr" }, { language: "ko" }] });
  assert.equal(await resolveSourceLang({ text: "x" }, detect), "ko");
  assert.equal(await resolveSourceLang({ text: "x", contentLang: "ja" }), "ja");
  assert.equal(await resolveSourceLang({ text: "x", contentLang: "ja", sourceLang: "ko" }), "ko");
  assert.equal(await resolveSourceLang({ text: "x", contentLang: "fr", pageLang: "ko" }), "ko");
  assert.equal(await resolveSourceLang({ text: "maison", pageLang: "fr" }), "en");
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
  const req = { text: "학교", sentence: "학교에 가요.", sourceLang: "ko" };

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
  assert.deepEqual(result, { ipa: "", reading: "", audioUrl: "", definitions: [], examples: [], kanji: [], base: null, frequency: null, errors: [] });
});

test("isPhrase counts words, or characters for languages without spaces", () => {
  assert.equal(isPhrase("ice cream", "en"), false);
  assert.equal(isPhrase("I like ice cream", "en"), true);
  assert.equal(isPhrase("ありがとうございます", "ja"), false);
  assert.equal(isPhrase("今日はとても暑いですね、本当に", "ja"), true);
});

test("deckFor uses the language's deck, or the fallback deck", () => {
  const { deckFor } = globalThis.LC.settings;
  const settings = { ...DEFAULTS, deck: "Default", decks: { ko: "Korean", ja: "" } };
  assert.equal(deckFor(settings, "ko"), "Korean");
  assert.equal(deckFor(settings, "ja"), "Default");
  assert.equal(deckFor(settings, "en"), "Default");
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
    return lang === "en" ? "the\nyou\nhorse\n" : "학교\n";
  });
  assert.equal(await frequency.rank("en", "Horse"), 3);
  assert.equal(await frequency.rank("en", "horses"), Infinity);
  assert.equal(await frequency.rank("ja", "猫"), null);
  assert.equal(await frequency.rank("ko", "학교"), 1);
  assert.equal(await frequency.rank("ko", "먹었다"), null);
  assert.deepEqual(loads, ["en", "ko"], "each list is loaded once");

  assert.deepEqual(frequencyLabel(1), { label: "Top 1k", rank: 1 });
  assert.deepEqual(frequencyLabel(1583), { label: "Top 2k", rank: 1583 });
  assert.deepEqual(frequencyLabel(20000), { label: "Top 20k", rank: 20000 });
  assert.deepEqual(frequencyLabel(Infinity), { label: "Rare", rank: null });
  assert.equal(frequencyLabel(null), null);
});

test("lookupDetails rates the base form's frequency and respects the setting", async () => {
  const pages = {
    먹었어요: { ko: [{ partOfSpeech: "Verb", definitions: [{ definition: 'polite past of <span class="form-of-definition-link"><i><a title="먹다">먹다</a></i></span>' }] }] },
    먹다: { ko: [{ partOfSpeech: "Verb", definitions: [{ definition: "to eat" }] }] },
  };
  const fetch = async (url) => {
    if (!url.includes("wiktionary")) return { ok: true, status: 200, json: async () => ({ data: [] }) };
    return { ok: true, status: 200, json: async () => pages[decodeURIComponent(url.split("/").pop())] };
  };
  const ranks = { 먹다: 1069 };
  const ctx = { fetch, frequency: { rank: async (lang, word) => (lang === "ko" ? (ranks[word] ?? Infinity) : null) } };

  const result = await lookupDetails({ text: "먹었어요", sourceLang: "ko" }, DEFAULTS, ctx);
  assert.equal(result.base.word, "먹다");
  assert.deepEqual(result.definitions, [{ pos: "Verb", text: "to eat" }]);
  assert.deepEqual(result.frequency, { label: "Top 2k", rank: 1069 });

  const off = { ...DEFAULTS, providers: { ...DEFAULTS.providers, frequency: false } };
  assert.equal((await lookupDetails({ text: "먹었어요", sourceLang: "ko" }, off, ctx)).frequency, null);
});


test("Korean particles are stripped when the word as written has no Wiktionary entry", async () => {
  assert.deepEqual(stripParticle("학교에서"), { word: "학교", particle: "에서" });
  assert.deepEqual(stripParticle("친구와"), { word: "친구", particle: "와" });
  assert.equal(stripParticle("에"), null);

  const pages = { 학교: { ko: [{ partOfSpeech: "Noun", definitions: [{ definition: "school" }] }] }, 아이: { ko: [{ partOfSpeech: "Noun", definitions: [{ definition: "child" }] }] } };
  const urls = [];
  const fetch = async (url) => {
    const word = decodeURIComponent(url.split("/").pop());
    urls.push(word);
    return pages[word] ? { ok: true, status: 200, json: async () => pages[word] } : { ok: false, status: 404 };
  };
  const school = await wiktionary.lookup({ text: "학교에", src: "ko" }, DEFAULTS, { fetch });
  assert.deepEqual(school.definitions, [{ pos: "Noun", text: "school" }]);
  assert.deepEqual(school.base, { word: "학교", formOf: "with the particle 에" });
  assert.deepEqual(urls, ["학교에", "학교"]);
  // A word that exists as written keeps its own entry.
  assert.equal((await wiktionary.lookup({ text: "아이", src: "ko" }, DEFAULTS, { fetch })).base, null);
});

test("lookups are offered only for text in the user's languages", () => {
  const { isLearned } = globalThis.LC.languages;
  assert.equal(isLearned(["学校", "学校に行く"], ["ja"]), true);
  // The kana in the sentence makes it Japanese, which a Chinese learner doesn't learn.
  assert.equal(isLearned(["学校", "学校に行く"], ["zh"]), false);
  assert.equal(isLearned(["学校", "我去学校"], ["zh"]), true);
  assert.equal(isLearned(["학교"], ["ja"]), false);
  assert.equal(isLearned(["학교"], ["ja", "ko"]), true);
  assert.equal(isLearned(["house", "The house is big."], ["ja", "ko", "zh"]), false);
  assert.equal(isLearned(["学校"], ["ko"]), false);
});

test("the card offers Japanese or Chinese only for Han text when both are learned", () => {
  const { hanChoices } = globalThis.LC.languages;
  assert.deepEqual(hanChoices(["学校", "学校"], ["zh", "ko", "ja"]), ["zh", "ja"]);
  assert.deepEqual(hanChoices(["学校", "学校に行く"], ["ja", "zh"]), []);
  assert.deepEqual(hanChoices(["学校"], ["ja"]), []);
  assert.deepEqual(hanChoices(["학교"], ["ja", "zh"]), []);
});

test("Korean verb endings lead back to the dictionary form", () => {
  const first = (word, n = 3) => verbCandidates(word).slice(0, n);
  assert.ok(first("먹었어요", 1).includes("먹다"));
  assert.ok(first("갔어요").includes("가다"));
  assert.ok(first("공부했습니다").includes("공부하다"));
  assert.ok(first("합니다", 1).includes("하다"));
  assert.ok(first("봐요").includes("보다"));
  assert.ok(first("가르쳐요").includes("가르치다"));
  assert.ok(first("어려워요").includes("어렵다"));
  assert.ok(first("갈", 1).includes("가다"));
  assert.ok(first("마셨어요").includes("마시다"));
  // 있어요 is 있다, which has to come before 이다 (the copula).
  assert.deepEqual(first("있어요", 2), ["있다", "이다"]);
  assert.ok(!verbCandidates("합니다").includes("합니다"));
  assert.deepEqual(verbCandidates("hello"), []);
});

test("Wiktionary tries the Korean verb's dictionary form", async () => {
  const pages = { 가다: { ko: [{ partOfSpeech: "Verb", definitions: [{ definition: "to go" }] }] } };
  const urls = [];
  const fetch = async (url) => {
    const word = decodeURIComponent(url.split("/").pop());
    urls.push(word);
    return pages[word] ? { ok: true, status: 200, json: async () => pages[word] } : { ok: false, status: 404 };
  };
  const result = await wiktionary.lookup({ text: "갔어요", src: "ko" }, DEFAULTS, { fetch });
  assert.deepEqual(result.base, { word: "가다", formOf: "conjugated form of 가다" });
  assert.deepEqual(result.definitions, [{ pos: "Verb", text: "to go" }]);
  assert.ok(urls.length <= 6, `at most a few requests, got ${urls.join(", ")}`);
});

test("CC-CEDICT finds both spellings and keeps several readings apart", async () => {
  const shard = [
    "学校\t學校\txué xiào\tschool/Classifier: 所",
    "行\t行\tháng\trow; line/line of business",
    "行\t行\théng\tused in 道行 (dào héng)",
    "行\t行\txíng\tto walk; to go/capable",
    "李\t李\tLǐ\tsurname Li",
    "李\t李\tlǐ\tplum",
  ].join("\n");
  assert.deepEqual(parseCedict(shard, "學校"), {
    reading: "xué xiào",
    definitions: [{ pos: "", text: "school" }, { pos: "", text: "Classifier: 所" }],
  });
  const walk = parseCedict(shard, "行");
  assert.equal(walk.reading, "háng / xíng");
  assert.deepEqual(walk.definitions.slice(0, 2), [{ pos: "háng", text: "row; line" }, { pos: "xíng", text: "to walk; to go" }]);
  assert.deepEqual(parseCedict(shard, "李"), { reading: "lǐ", definitions: [{ pos: "", text: "surname Li" }, { pos: "", text: "plum" }] });
  assert.deepEqual(parseCedict(shard, "猫"), { reading: "", definitions: [] });

  const loaded = [];
  await cedict.lookup({ text: "学校" }, DEFAULTS, { loadShard: async (n) => (loaded.push(n), shard) });
  assert.deepEqual(loaded, ["学".codePointAt(0) % 64]);
});

test("KANJIDIC breaks a Japanese word into its kanji", async () => {
  const kanjidicMap = parseKanjidic("学\tstudy; learning; science\tガク\tまな.ぶ\n校\texam; school; printing\tコウ、キョウ\t\n");
  const { kanji } = await kanjidic.lookup({ text: "学校に学ぶ" }, DEFAULTS, { kanjidic: kanjidicMap });
  assert.deepEqual(kanji, [
    { character: "学", meanings: "study; learning; science", on: "ガク", kun: "まな.ぶ" },
    { character: "校", meanings: "exam; school; printing", on: "コウ、キョウ", kun: "" },
  ]);
  assert.deepEqual((await kanjidic.lookup({ text: "ありがとう" }, DEFAULTS, { kanjidic: kanjidicMap })).kanji, []);
});
