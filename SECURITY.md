# Security

## Reporting a vulnerability

Please don't open a public issue. Report it privately on GitHub instead: **Security → Report a vulnerability** at [github.com/mirodn/language-companion/security](https://github.com/mirodn/language-companion/security/advisories/new). Include the Firefox and extension versions, what a page or attacker can do, and the steps to reproduce it.

You'll get an answer within a week. Fixes go out in a new release on addons.mozilla.org, and the changelog credits you unless you'd rather not be named.

Only the latest release is supported.

## How the extension protects you

The extension runs on every page, so it treats pages as untrusted:

- **Page text is never parsed as HTML.** Text from pages, dictionaries and translators goes into the DOM with `textContent`. The card sits in a closed shadow root that page scripts can't reach. The reader rebuilds articles from an allowlist of plain elements, without attributes or scripts.
- **Only real input counts.** Clicks, key presses and selections that a page script makes up (`isTrusted` false) are ignored. So a page can't open the card, add notes to Anki or use up your translator quota on its own.
- **Content scripts get only what the card needs.** The background only accepts lookups, the lookup card's Anki actions and text in images from web pages. Opening the reader, setting up Anki and changing your saved words only work from the extension's own pages.
- **Text in images only reads the tab you are looking at.** The screen is only captured for the visible tab that asks, and the screenshot never leaves your computer or gets saved.
- **Downloaded models are verified.** The text recognition models come from pinned Hugging Face revisions. Each file's SHA-256 is checked before it is stored or run.
- **Anki gets plain text.** Note fields are HTML-escaped. Only `http(s)` pages become links, and audio only comes from `https` URLs.
- **Strict extension pages.** Extension pages only run the extension's own scripts (`script-src 'self'`, plus WebAssembly for text recognition), with no plugins, `<base>` or form submissions.

What leaves your computer, and to which service, is listed in [PRIVACY.md](PRIVACY.md).
