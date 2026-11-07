# Publishing on addons.mozilla.org (AMO)

Everything to paste into the AMO forms, plus the steps. Nothing in `store/` goes into the extension package.

## Before each release

1. Bump `version` in `manifest.json` and `package.json` (AMO refuses a version it has seen before).
2. `npm test && npm run lint`: lint must report 0 errors. The two `innerHTML` warnings come from Mozilla's own Readability library, and the `import` warning from ONNX Runtime Web loading its own WebAssembly helper. All three are fine.
3. `npm run build` creates `web-ext-artifacts/language_companion-<version>.zip`.
4. Install that zip once in a clean profile (`about:debugging` → Load Temporary Add-on → pick the zip) and run the [smoke test](#smoke-test).

## First submission (by hand)

1. Sign in at https://addons.mozilla.org/developers/ with a Firefox account and accept the developer agreement.
2. **Submit a New Add-on** → **On this site** (public listing).
3. Upload the zip. Platforms: tick **Firefox** only. Android lacks the right-click menu the reader uses.
4. "Do you need to submit source code?" → **No**. Our own code is not minified, bundled or transpiled. The only minified files are ONNX Runtime Web, copied unmodified from npm (explained in the reviewer notes below), and the data files in `data/` are dictionaries converted by the scripts in `scripts/`.
5. Fill in the listing with the text below and add the three images from `store/screenshots/`.
6. Submit. Reviews usually take from a few hours to a few days. Mozilla emails you the result.

The extension ID `language-companion@mirodn` in `manifest.json` is permanent once submitted, so keep it as it is.

## Later updates

Upload the new zip under **Manage My Submissions** → Language Companion → **Upload New Version**, or from the terminal with API keys from https://addons.mozilla.org/developers/addon/api/key/:

```sh
npx web-ext sign --channel=listed --api-key=$AMO_JWT_ISSUER --api-secret=$AMO_JWT_SECRET
```

---

## Listing text

**Name:** Language Companion

**Add-on URL:** `language-companion`

**Summary** (250 characters max):

> Understand Japanese and Korean while you browse. Translate words and sentences on any page, in manga, in a reader view or in YouTube subtitles: readings, dictionary forms and kanji. Optionally save words to Anki.

**Categories:** Language Support

**License:** MIT License

**Homepage:** https://github.com/mirodn/language-companion
**Support site:** https://github.com/mirodn/language-companion/issues
**Support email:** (optional)

**Description:**

```
Language Companion helps you understand Japanese and Korean in real content. Select a word or a sentence and see what it means right there, without leaving the page.

• Translation, reading, dictionary form and kanji, plus the translation of the whole sentence
• Manga and webtoons: click a speech bubble to read and translate its text
• A calm reader view for articles, and clickable YouTube subtitles
• Optional: save words to Anki in one click

No account, no tracking. Text in images is recognised on your computer.

Data: Jisho, KANJIDIC2, Wiktionary, Tatoeba, FrequencyWords. Text recognition: manga-ocr, PaddleOCR.
```

**Privacy policy:** paste the contents of `PRIVACY.md` (with `https://github.com/mirodn/language-companion` filled in).

**Screenshot captions:**

1. `1-japanese-reader.png`: Reader view: reading, dictionary form and meaning at a glance.
2. `2-manga-bubble.png`: Click a speech bubble to read and translate its text. The page is our own drawing.
3. `3-korean-page.png`: Works on any page. Korean verbs lead to their dictionary form.

**Release notes for 0.5.0:**

> Now focused on translating Japanese and Korean. New: text in manga and webtoons (Shonen Jump+ and any site you turn on): click a speech bubble for its text and translation, select words in it. The card updates in place and can be dragged anywhere. Text recognition only runs while a manga page is on screen, and links stay clickable: a plain click never brings up the translator. Saving to Anki is now optional (off for new users, kept on if you used it). Safer: web pages can no longer drive the extension with made-up clicks, and downloaded models are verified. Chinese support was removed.

## Notes to reviewer

```
How to test:
1. After install a setup page opens. Anki is optional and off by default.
2. Open https://www3.nhk.or.jp/news/easy/ (or any Japanese page), select a word such as 食べる → a small "文A" button appears → click it for the card.
3. Toolbar button → "Open in reader" shows the article with clickable words. Hold Shift over a word for a tooltip.
4. Text in images: open a chapter on https://shonenjumpplus.com, click the toolbar button and turn on "Read text in images". Firefox asks for access to all websites: captureVisibleTab only works without a user gesture with <all_urls>. Outlines appear over speech bubbles; click one for its text.

Text in images: the visible tab is captured only on sites the user turned on, processed locally with ONNX models and never stored or sent. The models (PaddleOCR PP-OCRv5 and manga-ocr, Apache-2.0) are data, downloaded once from huggingface.co at pinned revisions, checked against their SHA-256 and kept in the Cache API. They are not code.

Third-party code:
- src/vendor/readability/Readability.js is Mozilla Readability 0.6.0, unmodified (Apache-2.0). The two innerHTML lint warnings come from it.
- src/vendor/onnxruntime-web/ (ort.wasm.min.mjs, ort-wasm-simd-threaded.mjs, ort-wasm-simd-threaded.wasm) is onnxruntime-web 1.31.1 from npm, unmodified (MIT): https://www.npmjs.com/package/onnxruntime-web/v/1.31.1 (dist/ folder). The dynamic import lint warning comes from it loading its own helper file.

Data files: data/kanjidic (KANJIDIC2) and data/frequency (FrequencyWords) are public dictionaries, CC BY-SA 4.0, converted to plain text by scripts/build-*.mjs in the source repository (https://github.com/mirodn/language-companion). They are data only, never executed.

Network: requests go only to the services in host_permissions with the looked-up word or sentence, to huggingface.co for the models, and to AnkiConnect on 127.0.0.1:8765 if the user turns Anki on. No analytics.
```

---

## Smoke test

Run in a fresh profile with the built zip:

- [ ] Install → setup page opens; "Save words to Anki" is off; ticking Korean adds a Korean sample
- [ ] Japanese page: select 食べました → card shows furigana, "JLPT N5", "Base form" link, one definition, the sentence and its translation; no deck menu or Add button
- [ ] M shows all definitions, kanji and examples as a plain list; M again hides them
- [ ] Select another word while the card is open → the same card updates; click empty space → it closes
- [ ] Click the pin → the card stays put while scrolling and on clicks outside; select more words → they appear in it; click the pin again → it follows the text. Dragging the header also pins
- [ ] Korean page: 갔어요 → "Base form: 가다"
- [ ] Kanji-only text (学校) is looked up as Japanese; English text: no lookup button appears
- [ ] Toolbar → Open in reader on a news article; click words; Shift peek
- [ ] YouTube with Japanese subtitles: click a subtitle word → video pauses → card → close → video resumes
- [ ] Shonen Jump+ chapter: toolbar switch → permission → "Getting text recognition ready…" → outlines on bubbles; the download shows MB progress; click a bubble → the card shows its text and translation; click/drag words → word view with ← back to the bubble; clicking a bubble doesn't turn the page; turning the page clears and rescans
- [ ] Shonen Jump+ home page and other pages without a manga page: no outlines, no "Getting text recognition ready…"; the viewer's arrows get no outline
- [ ] Shonen Jump+ chapter: hold Ctrl or ⌘ and click a bubble → the click reaches the page
- [ ] Normal page: click a link → nothing from the extension appears, the link opens. Select text → the 文A button shows and disappears after 4 seconds, but stays while the pointer is on it
- [ ] Reader: click a word in a link → the card shows "Open link ↗", which opens the link in a new tab
- [ ] Settings → turn on "Save words to Anki" (Anki open) → deck menus appear; card gets deck menu and Add to Anki; Enter adds; same word again says "Already in deck"
- [ ] With Anki on, quit Anki → card says "Anki is closed" → "Save for later" → reopen Anki → within 2 minutes the note appears
- [ ] Dark mode (system) looks right on the card (word and bubble views), the corner notes, the toolbar menu, reader, setup and settings pages
