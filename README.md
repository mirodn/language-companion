# Language Companion

A Firefox extension for learning languages with real content. Select a word on any page, see its translation, pronunciation, definitions and example sentences, and save it to Anki with one click.

> Read → select an unknown word → understand it → save it to Anki → review later.

**Status:** v0.3: web pages, YouTube subtitles, automatic translation, dictionaries, Anki integration. Netflix is next (see [Roadmap](#roadmap)).

## Features

- Lookup card next to the selected word: translation, IPA, audio (or local text-to-speech), definitions, example sentences, and the surrounding sentence with its translation
- One-click **Add to Anki** via AnkiConnect, with duplicate detection ("Already in deck → Open in Anki")
- Built-in "Language Companion" note type (created automatically) or your own note type with field mapping
- Choose definitions and the example before saving, or edit any field
- 29 languages, auto-detection of the source language
- Pluggable translators: MyMemory (free, no key), DeepL (API key), LibreTranslate (self-hosted)
- Dictionaries: Free Dictionary (English IPA and audio), Wiktionary (most languages), Tatoeba (example sentences)
- **YouTube:** click any word in the subtitles. The video pauses and the card opens. The subtitle line is saved as the sentence, with a link to the video at that moment
- Light and dark theme, keyboard shortcuts, context menu, per-site disable

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

1. Install AnkiConnect in Anki (Tools → Add-ons → Get Add-ons → code `2055492159`) and restart Anki.
2. Open the extension settings and click **Test connection**. Anki shows a dialog asking whether to allow the extension. Click **Yes**.
3. Pick your default deck.

If no dialog appears and the connection is refused, add the extension's origin to AnkiConnect's config manually (Tools → Add-ons → AnkiConnect → Config):

```json
"webCorsOriginList": ["http://localhost", "moz-extension://<your-extension-uuid>"]
```

You can find the UUID in `about:debugging` next to the extension ("Internal UUID").

## Usage

| Action | How |
| --- | --- |
| Look up | Select text and click the small button (or change the trigger in settings) |
| Look up | <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> or right-click → Look up |
| Look up and add right away | <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> |
| Add to Anki | <kbd>Enter</kbd> |
| Play pronunciation | <kbd>P</kbd> |
| Edit fields | <kbd>E</kbd> |
| Close | <kbd>Esc</kbd> |

### YouTube

Turn on subtitles in the player (any track, including auto-generated and auto-translated ones), then click a word. Shift+click a second word to look up the phrase between the two. The card works in fullscreen too. The video resumes when the card closes; you can turn pausing and resuming off in settings.

Saved notes get the subtitle line as the sentence, a Source link like `https://www.youtube.com/watch?v=…&t=83s` titled "Video title (1:23)", and the tag `lc::youtube`. The source language comes from the selected subtitle track.

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

Selected text and the surrounding sentence go to the translation and dictionary services you enable. Nothing else leaves your computer. Settings live in Firefox sync storage, and the lookup cache stays local.

## Roadmap

- **v0.4:** Netflix, audio clips and screenshots, more card templates, furigana for Japanese, AI translation provider
