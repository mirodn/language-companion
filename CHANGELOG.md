# Changelog

All notable changes to Language Companion. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.5.0] - 2026-11-07

Language Companion now focuses on understanding Japanese and Korean. Translating comes first; saving to Anki is optional.

### Reading and watching

- Text in images: on manga and webtoon sites, the extension finds the speech bubbles in the pages. Click one and the card shows its text and translation; click a word or drag across words to look them up, with the bubble as the sentence, and go back to the bubble with ← (or Backspace). Japanese is read with manga-ocr, which was trained on manga; Korean with PaddleOCR. On by default for Shonen Jump+; other sites have a switch in the toolbar menu. It runs on your computer and needs a one-time permission and a one-time download (about 120 MB for Japanese, 20 MB for Korean), with its progress shown in the corner

- Text in images only runs while a manga page is on screen, and only reads text inside it: not on a site's other pages, and not its buttons, arrows, covers or thumbnails
- Links stay links: speech bubbles no longer cover links and buttons on a manga page, and with Ctrl or ⌘ held, clicks go past the bubbles to the page. In the reader, the card has an **Open link** button for words in a link
- A plain click never brings up the translator, even with text still selected. The 文A button disappears after 4 seconds, and with "Open the card immediately", a selection that starts on a link shows the button instead of the card

### Lookup card

- Redesigned: a larger headword with furigana, the language and level as small badges, the translation first, and the sentence in its own block. Icons replace the emoji, the card fades in, and copy buttons sit next to translations
- While it looks up, the card shows placeholders instead of "Looking up…"; if a lookup fails, **Try again** repeats it
- Without Anki, a line at the bottom shows the keys (M more, P listen, Esc close)
- Selecting another word while the card is open shows that word in the same card, instead of closing it first. A plain click elsewhere still closes it, and while you edit a card, clicks on the page leave it alone
- Pin the card with the pin button in its header, or drag it by the header: it stays at that spot on screen, shows the next words there, and stays open when you click the page or turn pages, until you close it. Click the pin again (or double-click the header) to let it follow the text
- The sentence translation is shown right away. "Show the sentence translation right away" in the settings turns this off again

### Toolbar menu and settings

- The toolbar menu shows switches for the current site: translating there, reading text in images, and on YouTube the subtitles. A switch at the top pauses the extension everywhere
- The settings have a section list on the left, a "Saved" notice, and a new "Text in images" section with the permission, the list of sites and the downloaded models (with their size and a Delete button)

### Anki

- Saving to Anki is optional and off for new installs: the card then only translates, without a deck menu, Edit or Add to Anki, and the toolbar menu leaves out the Anki status and stats. Turn it on under Settings → Anki or on the setup page. If you already saved words or chose decks, it stays on
- The setup page starts with your languages and a place to try a lookup; connecting Anki is an optional last section

### Security

- Web pages can no longer drive the extension with made-up events: a page script could select text, open the card and press Enter to add notes to Anki, or keep translators (and your DeepL quota) busy, or keep text recognition running. Only real clicks, keys, selections and page events count now
- Text in images only captures the screen for the visible tab that asks for it. Before, a manga tab in the background could get the text of the tab you were looking at
- The background checks who sends each message: web pages only get lookups, the card's Anki actions and text in images; opening the reader, setting up Anki and changing saved words only work from the extension's own pages. Lookups are limited to 1000 characters
- Downloaded text recognition models are checked against their SHA-256 before they're stored or run. Older downloads, made without the check, are deleted on update and downloaded again when needed
- Anki notes only link to http(s) pages and only save audio from https URLs
- Stricter rules for the extension's own pages (no plugins, `<base>` or form submissions), and a [security policy](SECURITY.md) with how to report a vulnerability

### Removed

- Chinese: the CC-CEDICT dictionary, pinyin, the Japanese | Chinese switch on the card, and the Chinese word frequency list. Kanji-only text is now always looked up as Japanese. If Chinese was your only language, the setting falls back to Japanese

## [0.4.0] - 2026-10-31

The first public release.

### Lookup card

- Compact by default: translation, reading, the definition that goes on the card, and the sentence. **More** (<kbd>M</kbd>) shows all definitions, the kanji and example sentences, and the card remembers which view you used last
- The sentence translation stays hidden until you click it (<kbd>T</kbd>). A setting shows it right away
- Dictionary forms: 食べました → 食べる (Jisho), 갔어요 → 가다 and 학교에 → 학교 (Korean endings and particles). <kbd>B</kbd> looks up and saves the dictionary form instead
- Frequency badge: JLPT level for Japanese, "Top 1k" to "Top 20k" for Korean and Chinese
- Furigana for Japanese, pinyin for Chinese, and a kanji breakdown for Japanese words
- A Japanese | Chinese switch for text with only kanji/hanzi when you learn both

### Reading and watching

- Reader view: any article with every word clickable, keeping the page's furigana
- Quick peek: hold <kbd>Shift</kbd> over a word in the reader or YouTube subtitles
- Clickable YouTube subtitles: the video pauses, and the subtitle line and a timestamped link are saved with the note

### Anki

- One-click notes through AnkiConnect, with duplicate detection and a deck per language
- Notes are kept while Anki is closed and added once it opens
- Built-in note type, or your own with field mapping
- Tags for language, frequency and where the word came from

### Languages and dictionaries

- Japanese, Korean and Chinese, recognised from the writing system. Japanese is the default
- Built-in, offline: CC-CEDICT (Chinese), KANJIDIC2 (kanji), frequency lists
- Online: Jisho, Wiktionary, Tatoeba, and MyMemory, DeepL or LibreTranslate for translation

### Other

- First-run setup page for languages, AnkiConnect and decks
- Stats page with words per week and a streak
- Light and dark theme, keyboard shortcuts, context menu, per-site disable

[Unreleased]: https://github.com/mirodn/language-companion/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/mirodn/language-companion/releases/tag/v0.4.0
