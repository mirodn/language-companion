# Changelog

All notable changes to Language Companion. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

Language Companion now focuses on understanding Japanese and Korean. Translating comes first; saving to Anki is optional.

### Reading and watching

- Text in images: on manga and webtoon sites, the extension finds the speech bubbles in the pages. Click one to see its text and its translation next to it, then select words or whole sentences to look them up, with the bubble as the card's sentence. Japanese is read with manga-ocr, which was trained on manga; Korean with PaddleOCR. On by default for Shonen Jump+; other sites have a switch in the toolbar menu. It runs on your computer and needs a one-time permission and a one-time download (about 120 MB for Japanese, 20 MB for Korean)

### Lookup card

- Selecting another word while the card is open shows that word in the same card, instead of closing it first. A plain click elsewhere still closes it, and while you edit a card, clicks on the page leave it alone
- Drag the card by its header to move it. It stays at that spot on screen for the next words until you close it. Double-click the header to put it back next to the selection
- The sentence translation is shown right away. "Show the sentence translation right away" in the settings turns this off again

### Anki

- Saving to Anki is optional and off for new installs: the card then only translates, without a deck menu, Edit or Add to Anki, and the toolbar menu leaves out the Anki status and stats. Turn it on under Settings → Anki or on the setup page. If you already saved words or chose decks, it stays on
- The setup page starts with your languages and a place to try a lookup; connecting Anki is an optional last section

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
