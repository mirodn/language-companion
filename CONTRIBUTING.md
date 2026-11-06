# Contributing

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Reporting a bug

Open an issue with:

- what you did, what you expected and what happened instead
- the page or video, and the word you looked up, if it is about a lookup
- your Firefox version and the extension version (in `about:addons`)
- for Anki problems: your Anki and AnkiConnect versions

Errors from the extension show up in `about:debugging#/runtime/this-firefox` → Language Companion → **Inspect**.

Found a security problem? Please don't open an issue; report it privately as described in [SECURITY.md](SECURITY.md).

## Suggesting a feature

Open an issue describing what you were trying to do. The extension tries to stay small and focused on Japanese and Korean learners who want to understand what they read, so the use case matters more than the solution.

## Pull requests

1. For anything bigger than a small fix, open an issue first so we can agree on the approach.
2. Fork the repository and create a branch from `main`.
3. Make the change. Keep it focused: one fix or feature per pull request.
4. Run `npm test` and `npm run lint`. Both have to pass, and CI runs them too.
5. Try the change in Firefox with `npm start`.
6. Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) if users will notice the change.

### Code style

- Plain JavaScript, no build step and no runtime dependencies. Please don't add a framework or bundler.
- Match the code around your change: naming, comment style, and small focused functions.
- Text from pages and dictionaries goes into the DOM with `textContent`, never `innerHTML`.
- Event handlers that start something (a lookup, a scan, adding a note) ignore events with `isTrusted` false, so pages can't fake them.
- A new background message is for the extension's own pages only, unless it's added to the content-script list in `src/background/senders.js`.
- New network access needs a good reason, an entry in `host_permissions`, and a line in [PRIVACY.md](PRIVACY.md).
- Parsers for dictionary and translation responses get a unit test with a saved response in `test/fixtures/`.

### Adding a language

The languages are defined in `src/shared/languages.js`. A new language needs a way to recognise it (usually its script), at least one dictionary provider, and example sentences from Tatoeba. Please open an issue first.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
