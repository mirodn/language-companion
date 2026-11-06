// Quick peek: hold Shift while pointing at a clickable word (reader, YouTube subtitles) to see its
// reading and main meaning in a small tooltip, without opening the card. Shift+click still looks up
// a phrase as before.
(() => {
  const LC = globalThis.LC;

  const WORD_SELECTOR = ".w, .lc-yt-word";
  const GAP = 6;
  const CSS = `
    :host { all: initial; }
    .peek {
      position: fixed; z-index: 2147483647; max-width: 320px; padding: 6px 10px; border-radius: 8px;
      background: #1f1f22; color: #ececf0; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; pointer-events: none;
    }
    .word { font-weight: 600; }
    .reading, .base { color: #9a9aa2; margin-left: 6px; }
    .meaning { margin-top: 2px; }
    .loading { color: #9a9aa2; }`;

  // word text -> { word, reading, base, meaning }, or a promise while loading.
  const cache = new Map();
  let host = null;
  let box = null;
  let hovered = null;
  let shift = false;
  let shown = null;

  function ensureHost() {
    if (!host) {
      host = document.createElement("language-companion-peek");
      const shadow = host.attachShadow({ mode: "closed" });
      box = document.createElement("div");
      box.className = "peek";
      const style = document.createElement("style");
      style.textContent = CSS;
      shadow.append(style, box);
    }
    // In fullscreen only the fullscreen element is rendered.
    const container = document.fullscreenElement ?? document.documentElement;
    if (host.parentElement !== container) container.append(host);
  }

  // All parts of a word: furigana splits reader words into several spans with the same data-w.
  function partsOf(word) {
    return word.dataset.w ? [...document.querySelectorAll(`.w[data-w="${word.dataset.w}"]`)] : [word];
  }

  function hide() {
    shown = null;
    if (host) host.hidden = true;
  }

  function render(parts, data) {
    ensureHost();
    host.hidden = false;
    const line = (className, text) => Object.assign(document.createElement("span"), { className, textContent: text });
    if (!data) {
      box.replaceChildren(line("loading", "…"));
    } else {
      const head = document.createElement("div");
      head.append(line("word", data.word));
      if (data.reading) head.append(line("reading", data.reading));
      if (data.base) head.append(line("base", `→ ${data.base}`));
      const meaning = Object.assign(document.createElement("div"), { className: "meaning", textContent: data.meaning || "—" });
      box.replaceChildren(head, meaning);
    }
    // Above the word, or below it when there is no room.
    const first = parts[0].getBoundingClientRect();
    const last = parts.at(-1).getBoundingClientRect();
    const height = box.offsetHeight;
    const top = first.top - GAP - height >= 0 ? first.top - GAP - height : last.bottom + GAP;
    const left = Math.max(GAP, Math.min(first.left, window.innerWidth - box.offsetWidth - GAP));
    box.style.top = `${top}px`;
    box.style.left = `${left}px`;
  }

  async function peek(word) {
    const parts = partsOf(word);
    const text = parts.map((part) => part.textContent).join("").trim();
    if (!text || shown === text) return;
    shown = text;
    const cached = cache.get(text);
    render(parts, cached instanceof Promise ? null : cached);
    if (cached && !(cached instanceof Promise)) return;

    const request =
      cached ??
      browser.runtime
        .sendMessage({ type: LC.MSG.PEEK, text, pageLang: word.closest("[lang]")?.lang ?? "" })
        .then((response) => (response?.ok ? response.data : { word: text, meaning: response?.error ?? "" }));
    cache.set(text, request);
    const data = await request;
    cache.set(text, data);
    // Still pointing at the same word with Shift held.
    if (shown === text) render(parts, data);
  }

  function update() {
    if (shift && hovered?.isConnected) peek(hovered);
    else hide();
  }

  document.addEventListener(
    "mouseover",
    (event) => {
      // Ignores events a page script made up (see content.js).
      if (!event.isTrusted) return;
      hovered = event.target instanceof Element ? event.target.closest(WORD_SELECTOR) : null;
      shift = event.shiftKey;
      update();
    },
    true,
  );

  window.addEventListener(
    "keydown",
    (event) => {
      if (!event.isTrusted || event.key !== "Shift" || shift) return;
      shift = true;
      update();
    },
    true,
  );

  window.addEventListener("keyup", (event) => event.key === "Shift" && ((shift = false), hide()), true);
  window.addEventListener("blur", () => ((shift = false), hide()));
  document.addEventListener("scroll", hide, true);
})();
