# Privacy policy

Language Companion has no server, no account, no analytics and no tracking. The developer receives no data.

## What leaves your computer

When you look up a word, the word goes to the dictionary services that are turned on in the settings, and the word (plus the sentence around it, if "Also translate the surrounding sentence" is on) goes to the translator you chose:

| Service | Receives | When |
| --- | --- | --- |
| MyMemory (translated.net) | the word and the sentence, and your email if you entered one for a higher limit | default translator |
| DeepL | the word and the sentence, with your API key | only if you choose DeepL |
| LibreTranslate | the word and the sentence | only if you choose it and enter a server |
| Jisho | the word | Japanese lookups |
| Wiktionary | the word | Korean lookups, and other words without a better dictionary |
| Free Dictionary (dictionaryapi.dev) | the word | English lookups |
| Tatoeba | the word | example sentences |

Nothing else is sent: not the page address, not the page content, not who you are. Each service handles requests under its own privacy policy.

The Chinese dictionary (CC-CEDICT), the kanji dictionary (KANJIDIC2) and the word frequency lists are built into the extension and work offline.

## What stays on your computer

- **Anki:** words you save go to Anki on your own computer through AnkiConnect (`127.0.0.1`), together with the sentence and the page address and title as the source.
- **Settings**, including API keys, are kept in Firefox's sync storage. If you use Firefox Sync, Firefox syncs them between your devices, end-to-end encrypted.
- **Local storage:** the lookup cache, the list of saved words behind the stats page, and notes waiting for Anki to open.
- **Reader:** the article you open in the reader is kept in session storage until Firefox closes.

You can remove all of this by removing the extension.

## Permissions

- **Access to the current tab (activeTab, scripting):** to read the article when you click "Open in reader".
- **Content scripts on all sites:** to show the lookup button and card next to text you select.
- **Storage, alarms:** settings and the local data above; retrying notes for Anki every two minutes while Anki is closed.
- **Menus:** the right-click "Look up" and "Open in reader" entries.
- **Access to the services above and to 127.0.0.1:8765** (AnkiConnect).
- **Optional access to other sites:** asked for only when you enter your own LibreTranslate server or a different AnkiConnect address, and only for that address.

## Contact

Questions: open an issue at https://github.com/mirodn/language-companion.

Last updated: 2026-10-31
