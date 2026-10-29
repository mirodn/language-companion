import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnkiClient, buildNote, duplicateQuery, NOTE_TYPE, NOTE_FIELDS } from "../src/background/anki.js";

const settings = {
  deck: "Default",
  tags: "language-companion  extra",
  noteTypeMode: "builtin",
  mappedModel: "",
  fieldMap: {},
  saveAudio: true,
};

const card = {
  word: "Haus",
  translation: "house",
  definitions: ["house, building", "home <in phrases>"],
  ipa: "/haʊ̯s/",
  audioUrl: "https://example.org/audio/haus.ogg",
  sentence: "Das Haus ist groß.",
  sentenceTranslation: "The house is big.",
  example: { text: "In dem Haus haben wir gewohnt.", translation: "We lived in that house." },
  pageUrl: "https://example.org/?a=1&b=2",
  pageTitle: "Example",
  sourceLang: "de",
  targetLang: "en",
  deck: "German::Vocab",
};

function fakeFetch(handler) {
  const calls = [];
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    const { status = 200, json } = handler(body);
    return { ok: status < 400, status, json: async () => json };
  };
  return { fetch, calls };
}

test("buildNote fills the built-in note type and escapes HTML", () => {
  const note = buildNote(card, settings);
  assert.equal(note.modelName, NOTE_TYPE);
  assert.equal(note.deckName, "German::Vocab");
  assert.equal(note.fields.Word, "Haus");
  assert.equal(note.fields.Definition, "<ol><li>house, building</li><li>home &lt;in phrases&gt;</li></ol>");
  assert.equal(note.fields.Sentence, "Das <b>Haus</b> ist groß.");
  assert.equal(note.fields.Source, '<a href="https://example.org/?a=1&amp;b=2">Example</a>');
  assert.equal(note.fields.Example, "In dem Haus haben wir gewohnt.<br><i>We lived in that house.</i>");
  assert.deepEqual(note.tags, ["language-companion", "extra", "lc::de"]);
  assert.deepEqual(note.options, { allowDuplicate: false, duplicateScope: "deck" });
  assert.deepEqual(note.audio, [{ url: card.audioUrl, filename: "lc-de-haus.ogg", fields: ["Audio"] }]);
  assert.ok(Object.keys(note.fields).every((f) => NOTE_FIELDS.includes(f)));
});

test("buildNote maps fields onto a custom note type and merges shared targets", () => {
  const note = buildNote(card, {
    ...settings,
    noteTypeMode: "mapped",
    mappedModel: "Basic",
    fieldMap: { Word: "Front", Translation: "Back", Definition: "Back", Audio: "" },
  });
  assert.equal(note.modelName, "Basic");
  assert.deepEqual(Object.keys(note.fields), ["Front", "Back"]);
  assert.match(note.fields.Back, /^house<br><ol>/);
  assert.equal(note.audio, undefined);
});

test("buildNote skips audio when disabled and handles a single definition", () => {
  const note = buildNote({ ...card, definitions: ["house"] }, { ...settings, saveAudio: false });
  assert.equal(note.fields.Definition, "house");
  assert.equal(note.audio, undefined);
});

test("buildNote appends card tags, e.g. from YouTube", () => {
  const note = buildNote({ ...card, tags: ["lc::youtube"] }, settings);
  assert.deepEqual(note.tags, ["language-companion", "extra", "lc::de", "lc::youtube"]);
});

test("buildNote tags the frequency and highlights the word as written when saving the base form", () => {
  const note = buildNote({ ...card, word: "Haus", surface: "Häuser", sentence: "Die Häuser sind alt.", frequency: "Top 2k" }, settings);
  assert.equal(note.fields.Word, "Haus");
  assert.equal(note.fields.Sentence, "Die <b>Häuser</b> sind alt.");
  assert.deepEqual(note.tags, ["language-companion", "extra", "lc::de", "lc::freq::top-2k"]);
  assert.ok(buildNote({ ...card, frequency: "JLPT N5" }, settings).tags.includes("lc::freq::jlpt-n5"));
});

test("duplicateQuery escapes Anki search syntax", () => {
  assert.equal(duplicateQuery({ ...card, word: 'a_"b"' }, settings), '"deck:German::Vocab" "Word:a\\_&quot;b&quot;"');
});

test("client sends version 6 requests with the API key", async () => {
  const { fetch, calls } = fakeFetch(() => ({ json: { result: ["Default"], error: null } }));
  const client = createAnkiClient({ url: "http://127.0.0.1:8765", key: "secret", fetch });
  assert.deepEqual(await client.deckNames(), ["Default"]);
  assert.deepEqual(calls[0], { action: "deckNames", version: 6, params: {}, key: "secret" });
});

test("client surfaces AnkiConnect errors and connection failures", async () => {
  const { fetch } = fakeFetch(() => ({ json: { result: null, error: "deck was not found" } }));
  await assert.rejects(createAnkiClient({ url: "x", fetch }).deckNames(), /deck was not found/);

  const offline = createAnkiClient({ url: "x", fetch: async () => { throw new TypeError("NetworkError"); } });
  await assert.rejects(offline.version(), /Cannot reach Anki/);

  const { fetch: forbidden } = fakeFetch(() => ({ status: 403, json: {} }));
  await assert.rejects(createAnkiClient({ url: "x", fetch: forbidden }).version(), /refused/);
});

test("checkNote recognizes duplicates", async () => {
  const { fetch } = fakeFetch(() => ({
    json: { result: [{ canAdd: false, error: "cannot create note because it is a duplicate" }], error: null },
  }));
  const result = await createAnkiClient({ url: "x", fetch }).checkNote(buildNote(card, settings));
  assert.deepEqual(result, { canAdd: false, duplicate: true, error: "cannot create note because it is a duplicate" });
});

test("ensureNoteType creates the note type only when missing", async () => {
  const { fetch, calls } = fakeFetch(({ action }) => ({ json: { result: action === "modelNames" ? ["Basic"] : null, error: null } }));
  await createAnkiClient({ url: "x", fetch }).ensureNoteType();
  assert.deepEqual(calls.map((c) => c.action), ["modelNames", "createModel"]);
  assert.deepEqual(calls[1].params.inOrderFields, NOTE_FIELDS);

  const existing = fakeFetch(() => ({ json: { result: [NOTE_TYPE], error: null } }));
  await createAnkiClient({ url: "x", fetch: existing.fetch }).ensureNoteType();
  assert.equal(existing.calls.length, 1);
});

test("buildNote puts Japanese words with furigana in Pronunciation", () => {
  const note = buildNote({ ...card, word: "食べ物", reading: "たべもの", ipa: "", sourceLang: "ja" }, settings);
  assert.equal(note.fields.Word, "食べ物");
  assert.equal(note.fields.Pronunciation, "<ruby>食<rt>た</rt></ruby>べ<ruby>物<rt>もの</rt></ruby>");
});
