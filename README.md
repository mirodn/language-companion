# Language Companion

A Firefox extension for learning languages with real content. Select a word on any page, see its translation, pronunciation, definitions and example sentences, and save it to Anki with one click.

> Read → select an unknown word → understand it → save it to Anki → review later.

**Status:** v0.3: web pages, YouTube subtitles, automatic translation, dictionaries, Anki integration. Netflix is next (see [Roadmap](#roadmap)).

## Features

- Lookup card next to the selected word: translation, IPA, audio (or local text-to-speech), definitions, example sentences, and the surrounding sentence with its translation
- One-click **Add to Anki** via AnkiConnect, with duplicate detection ("Already in deck → Open in Anki")
- **Works while Anki is closed:** the card offers "Save for later", and saved notes are added automatically once Anki is open (or with "Add now" on the stats page)
- **Stats:** words per week, day streak, languages and sites you learn from (toolbar popup → Stats)
- Built-in "Language Companion" note type (created automatically) or your own note type with field mapping
- Choose definitions and the example before saving, or edit any field
- Translates Albanian, French, Japanese, Korean, Russian and Turkish into English. The language is detected automatically (writing system, Firefox's language detection, then telltale letters such as ë or ğ) and can be corrected on the card. English words get definitions only
- Phrases and sentences are only translated; dictionaries and example sentences are looked up for words and short expressions
- Pluggable translators: MyMemory (free, no key), DeepL (API key), LibreTranslate (self-hosted)
- Dictionaries: Free Dictionary (English IPA and audio), Jisho (Japanese readings and definitions), Wiktionary (most languages), Tatoeba (example sentences)
- **Base form:** inflected words show their base form ("courait → courir", "食べた → 食べる"). Click it (or press <kbd>B</kbd>) to look up and save the base form instead; the sentence keeps the word as written. Uses Wiktionary for most languages and Jisho for Japanese; Korean is mostly not covered
- **Word frequency** badge ("Top 1k" … "Top 20k", or "Rare") from bundled subtitle word lists, using the base form's rank. Japanese shows the JLPT level or "Common" instead. Saved notes get a tag such as `lc::freq::top-2k`
- **Furigana** for Japanese words: readings over each kanji on the card, and in the Pronunciation field of the Anki note (shown on the back)
- **YouTube:** click any word in the subtitles. The video pauses and the card opens. The subtitle line is saved as the sentence, with a link to the video at that moment
- **Dual subtitles on YouTube** (optional): a translation of each subtitle line appears under it
- A deck per language (e.g. Albanian words go to your Albanian deck), set in the settings
- Light and dark theme, keyboard shortcuts, context menu, per-site disable (in settings)

## Install (development)

Requirements: Firefox 128+, Node.js 18+, [Anki Desktop](https://apps.ankiweb.net/) with [AnkiConnect](https://ankiweb.net/shared/info/2055492159).

```sh
npm install
npm start        # launches Firefox with the extension loaded
```

Or load it by hand: open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `manifest.json`.

Other scripts:

```sh
npm test         # unit tests (no browser needed)
npm run lint     # web-ext lint
npm run build    # zip in web-ext-artifacts/
```

## Connecting Anki

1. In Anki, install AnkiConnect: Tools → Add-ons → Get Add-ons → code `2055492159`. Restart Anki.
2. Open Tools → Add-ons → AnkiConnect → **Config** and add the extension's origin to `webCorsOriginList`:

   ```json
   {
       "apiKey": null,
       "apiLogPath": null,
       "ignoreOriginList": [],
       "webBindAddress": "127.0.0.1",
       "webBindPort": 8765,
       "webCorsOriginList": [
           "http://localhost",
           "moz-extension://62507959-2455-4db3-851d-e4b7ccd8ed3b"
       ]
   }
   ```

   This UUID is the one `npm start` uses (it is pinned in `web-ext-config.mjs`). If you installed the extension in your normal Firefox profile instead, use the UUID shown in `about:debugging#/runtime/this-firefox` next to the extension ("Internal UUID"). It stays the same for that profile.
3. Click **Save** and restart Anki.
4. In the extension settings, click **Test connection**. It should say "Connected".
5. Under **Decks**, pick a deck for each language. Changing the deck on a card also changes it for that card's language.

Keep `webBindAddress` at `127.0.0.1`, so only your own computer can reach Anki. An API key is not needed then. If you set one in AnkiConnect, enter the same key in the extension settings.

If the test still fails, make sure Anki is running and the origin is not listed under `ignoreOriginList`. AnkiConnect adds an origin there when you click **No** in its permission dialog.

## Usage

| Action | How |
| --- | --- |
| Look up | Select text and click the small button (or change the trigger in settings) |
| Look up | <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> or right-click → Look up |
| Look up and add right away | <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> |
| Add to Anki | <kbd>Enter</kbd> |
| Play pronunciation | <kbd>P</kbd> |
| Edit fields | <kbd>E</kbd> |
| Use the base form | <kbd>B</kbd> |
| Close | <kbd>Esc</kbd> |

### YouTube

Turn on subtitles in the player (any track, including auto-generated and auto-translated ones), then click a word. Shift+click a second word to look up the phrase between the two. The card works in fullscreen too. The video resumes when the card closes; you can turn pausing and resuming off in settings.

Saved notes get the subtitle line as the sentence, a Source link like `https://www.youtube.com/watch?v=…&t=83s` titled "Video title (1:23)", and the tag `lc::youtube`. The source language comes from the selected subtitle track.

**Dual subtitles:** turn on "Translation under YouTube subtitles" in the toolbar popup or the settings. Each line is translated with your translator, so it uses that translator's quota: MyMemory allows about 100 lines a day (about 1,000 with an email in the settings), DeepL Free about 500,000 characters a month. Auto-generated subtitles appear word by word; a line is translated once it has stayed on screen for a moment. English subtitles are not translated.

Global shortcuts can be changed in `about:addons` → ⚙ → Manage Extension Shortcuts.

## Project structure

```
manifest.json
src/
  shared/        messages, languages, settings (plain scripts that fill globalThis.LC)
  background/    message router, AnkiConnect client, lookup + cache
    providers/   one file per translator / dictionary / example source
  content/       selection handling and the in-page card (shadow DOM)
  action/        toolbar popup
  stats/         stats page and the numbers behind it
data/frequency/  bundled word frequency lists (built by scripts/build-frequency.mjs)
  options/       settings page
test/            node:test unit tests with saved API responses
```

### Adding a provider

Create `src/background/providers/<name>.js` exporting:

```js
export default {
  id: "myprovider",
  name: "My Provider",
  kind: "translate", // or "dictionary" / "examples"
  needsKey: false,
  supports: (src, tgt) => true,
  async lookup({ text, src, tgt }, settings, ctx) {
    // return { translation } or { ipa, audioUrl, definitions, examples } or { examples }
  },
};
```

Then register it in `providers/index.js` and add its host to `host_permissions` in the manifest.

## Privacy

Selected text and the surrounding sentence go to the translation and dictionary services you enable. Nothing else leaves your computer. Settings live in Firefox sync storage. The lookup cache, the list of saved words behind the stats, and notes waiting for Anki stay local.

## Credits

Word frequency lists: [FrequencyWords](https://github.com/hermitdave/FrequencyWords) by Hermit Dave, CC BY-SA 4.0 (see [data/frequency/ATTRIBUTION.md](data/frequency/ATTRIBUTION.md)).

## Roadmap

- **v0.4:** Netflix, audio clips and screenshots, more card templates, AI translation provider
