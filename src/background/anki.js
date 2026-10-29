// AnkiConnect client (https://git.sr.ht/~foosoft/anki-connect) and note building.
import "../shared/furigana.js";

const { furigana } = globalThis.LC;

export const NOTE_TYPE = "Language Companion";

// Order matters: Anki checks duplicates against the first field.
export const NOTE_FIELDS = [
  "Word",
  "Translation",
  "Definition",
  "Pronunciation",
  "Audio",
  "Sentence",
  "SentenceTranslation",
  "Example",
  "Source",
  "Language",
];

export class AnkiError extends Error {}

export function createAnkiClient({ url, key, fetch: fetchImpl = globalThis.fetch }) {
  async function invoke(action, params = {}) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, version: 6, params, ...(key ? { key } : {}) }),
      });
    } catch {
      throw new AnkiError("Cannot reach Anki. Is Anki open with AnkiConnect installed?");
    }
    if (response.status === 403) {
      throw new AnkiError("AnkiConnect refused the request. Allow this extension in AnkiConnect (see README).");
    }
    if (!response.ok) throw new AnkiError(`AnkiConnect returned HTTP ${response.status}`);
    const { result, error } = await response.json();
    if (error) throw new AnkiError(error);
    return result;
  }

  return {
    invoke,
    version: () => invoke("version"),
    // Shows an "allow this origin?" dialog in Anki the first time.
    requestPermission: () => invoke("requestPermission"),
    deckNames: () => invoke("deckNames"),
    modelNames: () => invoke("modelNames"),
    modelFieldNames: (modelName) => invoke("modelFieldNames", { modelName }),

    async ensureNoteType() {
      const models = await invoke("modelNames");
      if (!models.includes(NOTE_TYPE)) await invoke("createModel", NOTE_TYPE_DEFINITION);
    },

    async checkNote(note) {
      const [detail] = await invoke("canAddNotesWithErrorDetail", { notes: [note] });
      return {
        canAdd: detail.canAdd,
        duplicate: !detail.canAdd && /duplicate/i.test(detail.error ?? ""),
        error: detail.error ?? null,
      };
    },

    addNote: (note) => invoke("addNote", { note }),
    browse: (query) => invoke("guiBrowse", { query }),
  };
}

// Builds an AnkiConnect note from the card the user saw (and maybe edited).
// card: { word, translation, definitions[], ipa, reading, audioUrl, sentence, sentenceTranslation,
//         example: {text, translation}|null, pageUrl, pageTitle, sourceLang, targetLang, deck, tags? }
export function buildNote(card, settings) {
  const values = {
    Word: escapeHtml(card.word),
    Translation: escapeHtml(card.translation),
    Definition: card.definitions.length > 1
      ? `<ol>${card.definitions.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ol>`
      : escapeHtml(card.definitions[0] ?? ""),
    // Japanese: the word with furigana, so the reading shows on the back of the card.
    Pronunciation: card.reading ? rubyHtml(card.word, card.reading) : escapeHtml(card.ipa),
    Audio: "",
    Sentence: highlight(card.sentence, card.word),
    SentenceTranslation: escapeHtml(card.sentenceTranslation),
    Example: card.example
      ? [escapeHtml(card.example.text), card.example.translation && `<i>${escapeHtml(card.example.translation)}</i>`]
          .filter(Boolean)
          .join("<br>")
      : "",
    Source: card.pageUrl ? `<a href="${escapeHtml(card.pageUrl)}">${escapeHtml(card.pageTitle || card.pageUrl)}</a>` : "",
    Language: escapeHtml(card.sourceLang),
  };

  const { modelName, fieldMap } = resolveNoteType(settings);
  const fields = {};
  for (const lcField of NOTE_FIELDS) {
    const target = fieldMap[lcField];
    if (!target || !values[lcField]) continue;
    fields[target] = fields[target] ? `${fields[target]}<br>${values[lcField]}` : values[lcField];
  }

  const note = {
    deckName: card.deck || settings.deck,
    modelName,
    fields,
    tags: [...settings.tags.split(/\s+/).filter(Boolean), `lc::${card.sourceLang}`, ...(card.tags ?? [])],
    options: { allowDuplicate: false, duplicateScope: "deck" },
  };

  if (settings.saveAudio && card.audioUrl && fieldMap.Audio) {
    note.audio = [{ url: card.audioUrl, filename: audioFilename(card), fields: [fieldMap.Audio] }];
  }
  return note;
}

export function resolveNoteType(settings) {
  if (settings.noteTypeMode === "mapped" && settings.mappedModel) {
    return { modelName: settings.mappedModel, fieldMap: settings.fieldMap ?? {} };
  }
  return { modelName: NOTE_TYPE, fieldMap: Object.fromEntries(NOTE_FIELDS.map((f) => [f, f])) };
}

// Anki browser query for the existing note of a word, used by "Open in Anki".
export function duplicateQuery(card, settings) {
  const { fieldMap } = resolveNoteType(settings);
  const term = (s) => `"${String(s).replace(/([\\"*_])/g, "\\$1")}"`;
  return `${term(`deck:${card.deck || settings.deck}`)} ${term(`${fieldMap.Word}:${escapeHtml(card.word)}`)}`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rubyHtml(word, reading) {
  return furigana
    .segments(word, reading)
    .map(({ text, rt }) => (rt ? `<ruby>${escapeHtml(text)}<rt>${escapeHtml(rt)}</rt></ruby>` : escapeHtml(text)))
    .join("");
}

function highlight(sentence, word) {
  const escaped = escapeHtml(sentence);
  const target = escapeHtml(word);
  if (!target) return escaped;
  const index = escaped.toLowerCase().indexOf(target.toLowerCase());
  if (index < 0) return escaped;
  return `${escaped.slice(0, index)}<b>${escaped.slice(index, index + target.length)}</b>${escaped.slice(index + target.length)}`;
}

function audioFilename(card) {
  const ext = card.audioUrl.match(/\.(mp3|ogg|oga|wav|m4a)(?:$|\?)/i)?.[1] ?? "mp3";
  const slug = card.word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `lc-${card.sourceLang}-${slug || "word"}.${ext}`;
}

const NOTE_TYPE_DEFINITION = {
  modelName: NOTE_TYPE,
  inOrderFields: NOTE_FIELDS,
  isCloze: false,
  css: `.card {
  font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
  font-size: 20px;
  line-height: 1.5;
  text-align: center;
  color: #1d1d1f;
  background: #fafafa;
  padding: 24px;
}
.nightMode.card, .night_mode .card { color: #e8e8ea; background: #1c1c1e; }
.word { font-size: 2em; font-weight: 600; }
.ipa { color: #6e6e73; font-size: 0.9em; }
.ipa ruby { font-size: 1.6em; color: #1d1d1f; }
.nightMode .ipa ruby { color: #e8e8ea; }
.sentence { margin-top: 16px; }
.sentence b { color: #2f6fed; }
.nightMode .sentence b { color: #7aa7ff; }
.translation { font-size: 1.4em; font-weight: 600; margin: 12px 0; }
.muted { color: #6e6e73; font-size: 0.85em; }
.definition, .example { text-align: left; max-width: 560px; margin: 12px auto; font-size: 0.9em; }
.source { margin-top: 20px; font-size: 0.75em; }
.source a { color: inherit; }
hr { border: none; border-top: 1px solid #d2d2d7; margin: 20px 0; }
.nightMode hr { border-top-color: #3a3a3c; }`,
  cardTemplates: [
    {
      Name: "Recognition",
      Front: `<div class="word">{{Word}}</div>
{{#Sentence}}<div class="sentence">{{Sentence}}</div>{{/Sentence}}`,
      Back: `{{FrontSide}}
<hr id="answer">
{{#Pronunciation}}<div class="ipa">{{Pronunciation}}</div>{{/Pronunciation}}
{{Audio}}
<div class="translation">{{Translation}}</div>
{{#SentenceTranslation}}<div class="muted">{{SentenceTranslation}}</div>{{/SentenceTranslation}}
{{#Definition}}<div class="definition">{{Definition}}</div>{{/Definition}}
{{#Example}}<div class="example">{{Example}}</div>{{/Example}}
{{#Source}}<div class="source">{{Source}}</div>{{/Source}}`,
    },
  ],
};
