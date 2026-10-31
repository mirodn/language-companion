# Publishing on addons.mozilla.org (AMO)

Everything to paste into the AMO forms, plus the steps. Nothing in `store/` goes into the extension package.

## Before each release

1. Bump `version` in `manifest.json` and `package.json` (AMO refuses a version it has seen before).
2. `npm test && npm run lint`: lint must report 0 errors. The two `innerHTML` warnings come from Mozilla's own Readability library and are fine.
3. `npm run build` creates `web-ext-artifacts/language_companion-<version>.zip`.
4. Install that zip once in a clean profile (`about:debugging` → Load Temporary Add-on → pick the zip) and run the [smoke test](#smoke-test).

## First submission (by hand)

1. Sign in at https://addons.mozilla.org/developers/ with a Firefox account and accept the developer agreement.
2. **Submit a New Add-on** → **On this site** (public listing).
3. Upload the zip. Platforms: tick **Firefox** only. Android lacks the right-click menu the reader uses.
4. "Do you need to submit source code?" → **No**. Nothing is minified, bundled or transpiled. The data files in `data/` are dictionaries converted by the scripts in `scripts/` (explained in the reviewer notes below).
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

> Learn Japanese, Korean and Chinese while you browse. Look up words on any page, in a clean reader view or in YouTube subtitles: readings, dictionary forms, kanji and pinyin, and save them to Anki in one click.

**Categories:** Language Support

**License:** MIT License

**Homepage:** https://github.com/mirodn/language-companion
**Support site:** https://github.com/mirodn/language-companion/issues
**Support email:** (optional)

**Description:**

```
Language Companion helps you learn Japanese, Korean and Chinese from real content: news, blogs, novels and YouTube. Select a word, understand it in context, and save it to Anki without leaving the page.

<b>Look up any word</b>
• Translation, reading and the main definition at a glance; more definitions, kanji and example sentences one click away
• Furigana for Japanese, pinyin for Chinese
• Conjugated words lead to their dictionary form: 食べました → 食べる, 갔어요 → 가다, 학교에 → 학교
• Kanji breakdown: 学校 → 学 study · 校 school
• JLPT level or word frequency ("Top 2k"), so you know what is worth learning first
• The sentence translation stays hidden until you click, so you can try the sentence yourself first

<b>Reader</b>
Open any article in a calm reader view where every word is clickable. This helps most with Japanese and Chinese, where words have no spaces between them. Hold Shift over a word for a quick peek at its reading and meaning.

<b>YouTube</b>
Click a word in the subtitles. The video pauses, the card opens, and the subtitle line is saved as the sentence, with a link back to that moment in the video.

<b>Anki</b>
• One click (or Enter) adds a note with the word, reading, meaning, sentence, audio and source
• A deck per language, duplicate detection, your own note type if you like
• Anki closed? Notes are saved and added as soon as Anki opens
• A stats page shows words per week and your streak

<b>Setup</b>
A setup page walks you through connecting Anki (needs Anki Desktop with the free AnkiConnect add-on). Lookups work without Anki too.

<b>Privacy</b>
No account, no tracking, no server of its own. Only the word you look up goes to the dictionary and translation services you turn on. The Chinese and kanji dictionaries work offline.

Dictionaries: Jisho, CC-CEDICT, KANJIDIC2, Wiktionary, Tatoeba, FrequencyWords. Thanks to their authors.
```

**Privacy policy:** paste the contents of `PRIVACY.md` (with `https://github.com/mirodn/language-companion` filled in).

**Screenshot captions:**

1. `1-japanese-reader.png`: Click any word in the reader: reading, dictionary form and meaning at a glance.
2. `2-chinese-more.png`: "More" shows every definition to choose from, plus example sentences.
3. `3-korean-page.png`: Works on any page. Korean verbs lead to their dictionary form.

**Release notes for 0.4.0:**

> A calmer card: translation, reading and the main definition first, everything else under "More" (M). The sentence translation stays hidden until you click it (T) — or turn that off in the settings. Also new since 0.3: a setup page, an offline Chinese dictionary with pinyin, a kanji breakdown, Korean verb forms (갔어요 → 가다) and quick peek with Shift.

## Notes to reviewer

```
How to test:
1. After install a setup page opens. Anki is optional for testing: lookups work without it.
2. Open https://www3.nhk.or.jp/news/easy/ (or any Japanese page), select a word such as 食べる → a small "文A" button appears → click it for the card.
3. Toolbar button → "Open in reader" shows the article with clickable words. Hold Shift over a word for a tooltip.
4. Saving to Anki needs Anki Desktop with the AnkiConnect add-on (code 2055492159); the setup page explains the one config line.

Data files: data/cedict (CC-CEDICT), data/kanjidic (KANJIDIC2) and data/frequency (FrequencyWords) are public dictionaries, CC BY-SA 4.0, converted to plain text by scripts/build-*.mjs in the source repository (https://github.com/mirodn/language-companion). They are data only, never executed.

Third-party code: src/vendor/readability/Readability.js is Mozilla Readability 0.6.0, unmodified (Apache-2.0). The two innerHTML lint warnings come from it.

Network: requests go only to the services in host_permissions, with the looked-up word or sentence. AnkiConnect runs on 127.0.0.1:8765. No analytics.
```

---

## Smoke test

Run in a fresh profile with the built zip, Anki open:

- [ ] Install → setup page opens; ticking Korean shows a Korean deck row; "Check connection" turns green
- [ ] Japanese page: select 食べました → compact card shows furigana, "JLPT N5", "Base form" link, one definition, "Show translation"
- [ ] T shows the sentence translation; M shows all definitions, kanji and examples; M again hides them
- [ ] Settings → "Show the sentence translation right away" → next card shows it without clicking
- [ ] Enter adds the note; the same word again says "Already in deck"
- [ ] Quit Anki → card says "Anki is closed" → "Save for later" → reopen Anki → within 2 minutes the note appears
- [ ] Chinese page: 习惯 shows pinyin xí guàn and CC-CEDICT definitions
- [ ] Korean page: 갔어요 → "Base form: 가다"
- [ ] Toolbar → Open in reader on a news article; click words; Shift peek
- [ ] YouTube with Japanese subtitles: click a subtitle word → video pauses → card → close → video resumes
- [ ] English text: no lookup button appears
- [ ] Dark mode (system) looks right on the card, reader, setup and settings pages
