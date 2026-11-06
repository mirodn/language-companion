// Which parts of the extension may send which messages to the background.
// Content scripts run on every site, so they only get what the lookup card and text in images
// need. Everything else (reading other tabs, Anki setup, the saved words) is for the extension's
// own pages: the toolbar popup, settings, welcome, stats and reader.
import "../shared/messages.js";

const { MSG } = globalThis.LC;

const FROM_CONTENT = new Set([
  MSG.LOOKUP,
  MSG.LOOKUP_DETAILS,
  MSG.PEEK,
  MSG.GET_CARD_CSS,
  MSG.ANKI_DECKS,
  MSG.ANKI_CHECK_DUPLICATE,
  MSG.ANKI_ADD_NOTE,
  MSG.ANKI_BROWSE,
  MSG.OCR_PERMISSION,
  MSG.OCR_SCAN,
  MSG.OCR_READ,
]);
// These act on the sender's own tab.
const NEEDS_TAB = new Set([MSG.OCR_SCAN, MSG.OCR_READ]);

// baseUrl: browser.runtime.getURL(""), e.g. "moz-extension://<uuid>/".
export function isExtensionPage(sender, baseUrl) {
  return typeof sender?.url === "string" && sender.url.startsWith(baseUrl);
}

// id: browser.runtime.id. Messages from other extensions never reach runtime.onMessage, but
// checking costs nothing.
export function allowed(type, sender, { id, baseUrl }) {
  if (sender?.id !== id) return false;
  if (isExtensionPage(sender, baseUrl)) return !NEEDS_TAB.has(type) || Boolean(sender.tab);
  return FROM_CONTENT.has(type) && (!NEEDS_TAB.has(type) || Boolean(sender.tab));
}
