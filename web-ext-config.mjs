// Fixed internal UUID for `npm start`, so the extension's origin stays the same between runs
// and only has to be allowed in AnkiConnect once.
const DEV_UUID = "62507959-2455-4db3-851d-e4b7ccd8ed3b";

export default {
  // src/lab is the OCR test page for development.
  ignoreFiles: [".github", "test", "scripts", "store", "src/lab", "CHANGELOG.md", "CONTRIBUTING.md", "package.json", "package-lock.json", "README.md", "PRIVACY.md", "SECURITY.md", "web-ext-config.mjs"],
  run: {
    // web-ext wraps string prefs in quotes without escaping the ones inside, so escape them here.
    pref: [`extensions.webextensions.uuids=${JSON.stringify(JSON.stringify({ "language-companion@mirodn": DEV_UUID })).slice(1, -1)}`],
  },
};
