import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/shared/messages.js";
import { allowed, isExtensionPage } from "../src/background/senders.js";

const { MSG } = globalThis.LC;

const info = { id: "language-companion@mirodn", baseUrl: "moz-extension://abc/" };
const tab = { id: 7, windowId: 1 };
const contentScript = { id: info.id, url: "https://example.org/page", tab, frameId: 0 };
const toolbarPopup = { id: info.id, url: "moz-extension://abc/src/action/popup.html" };
const readerPage = { id: info.id, url: "moz-extension://abc/src/reader/reader.html#x", tab };

test("isExtensionPage only matches the extension's own origin", () => {
  assert.equal(isExtensionPage(toolbarPopup, info.baseUrl), true);
  assert.equal(isExtensionPage(contentScript, info.baseUrl), false);
  assert.equal(isExtensionPage({ url: "moz-extension://other/src/action/popup.html" }, info.baseUrl), false);
  assert.equal(isExtensionPage({}, info.baseUrl), false);
});

test("content scripts get what the card and text in images need", () => {
  for (const type of [MSG.LOOKUP, MSG.LOOKUP_DETAILS, MSG.PEEK, MSG.GET_CARD_CSS, MSG.ANKI_DECKS, MSG.ANKI_ADD_NOTE, MSG.ANKI_CHECK_DUPLICATE, MSG.ANKI_BROWSE, MSG.OCR_SCAN, MSG.OCR_READ]) {
    assert.equal(allowed(type, contentScript, info), true, type);
  }
});

test("content scripts can't open other tabs in the reader or change Anki and the saved words", () => {
  for (const type of [MSG.OPEN_READER, MSG.ANKI_STATUS, MSG.ANKI_CREATE_DECK, MSG.ANKI_MODELS, MSG.ANKI_MODEL_FIELDS, MSG.LOG_REMOVE, MSG.QUEUE_FLUSH]) {
    assert.equal(allowed(type, contentScript, info), false, type);
  }
});

test("extension pages may send everything", () => {
  for (const type of [MSG.OPEN_READER, MSG.ANKI_CREATE_DECK, MSG.LOG_REMOVE, MSG.LOOKUP]) {
    assert.equal(allowed(type, toolbarPopup, info), true, type);
  }
  assert.equal(allowed(MSG.ANKI_ADD_NOTE, readerPage, info), true);
});

test("text in images needs the sender's tab", () => {
  assert.equal(allowed(MSG.OCR_SCAN, { ...contentScript, tab: undefined }, info), false);
  assert.equal(allowed(MSG.OCR_READ, toolbarPopup, info), false);
});

test("messages from another extension are refused", () => {
  assert.equal(allowed(MSG.LOOKUP, { ...contentScript, id: "someone-else" }, info), false);
  assert.equal(allowed(MSG.LOG_REMOVE, { ...toolbarPopup, id: "someone-else" }, info), false);
});
