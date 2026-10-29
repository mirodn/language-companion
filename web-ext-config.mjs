// Fixed internal UUID for `npm start`, so the extension's origin stays the same between runs
// and only has to be allowed in AnkiConnect once.
const DEV_UUID = "62507959-2455-4db3-851d-e4b7ccd8ed3b";

export default {
  ignoreFiles: ["test", "scripts", "package.json", "package-lock.json", "README.md", "web-ext-config.mjs"],
  run: {
    pref: [`extensions.webextensions.uuids=${JSON.stringify({ "language-companion@mirodn": DEV_UUID })}`],
  },
};
