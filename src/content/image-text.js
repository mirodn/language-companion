// Reads text in images on manga and webtoon sites (settings.imageTextSites).
// The background captures the visible tab, finds the speech bubbles and reads them
// (background/ocr.js). This script outlines the bubbles; clicking one opens the card on its text
// (content.js openSentence), where words can be picked and looked up, with the bubble as the
// sentence. The page is scanned again whenever it changes (page turn, scroll).
(() => {
  const LC = globalThis.LC;
  const { MSG } = LC;

  // Wait this long after the last page event before scanning, so page-turn animations are done.
  const SETTLE_MS = 600;
  // A manga page is a large picture on screen. Thumbnails, buttons and the site around it aren't read.
  const MIN_PICTURE_SIDE = 250;
  const MIN_PICTURES_SHARE = 0.15;
  // Links and buttons on a page stay clickable. Larger ones are a viewer's areas for turning pages.
  const MAX_LINK_SHARE = 0.15;
  // How often to look for a page: viewers draw theirs after loading, without any page event.
  const WATCH_MS = 1000;
  // Show a note only when a scan is slow, which is mostly the first model download.
  const STATUS_DELAY_MS = 800;
  // How long the bubbles' outlines show after a scan, so it's clear where the text is.
  const FLASH_MS = 1200;
  const HINT_MS = 8000;
  const HINT_SEEN_KEY = "imageTextHintSeen";
  // Neighbouring lines closer than this share of their width (columns) or height (rows) form a bubble.
  const BUBBLE_GAP = 0.8;
  const BUBBLE_PADDING = 4;
  // Keys that may turn the page or scroll. Others (card shortcuts like Enter or M) don't rescan.
  const NAVIGATION_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "];

  // Page CSS can't style these tags; everything else is set here or inline.
  const LAYER_STYLE = `
    language-companion-bubble { display: block; position: fixed; pointer-events: auto; cursor: pointer; border-radius: 6px;
      outline: 2px solid transparent; outline-offset: 1px; transition: outline-color 500ms, background-color 120ms; }
    language-companion-text-layer[data-flash] language-companion-bubble { outline-color: rgba(47, 111, 237, 0.4); }
    language-companion-text-layer[data-through] language-companion-bubble { pointer-events: none; }
    language-companion-bubble:hover, language-companion-bubble[data-open] {
      background: rgba(47, 111, 237, 0.08); outline-color: rgba(47, 111, 237, 0.65); transition-duration: 120ms; }
    @media (prefers-reduced-motion: reduce) { language-companion-bubble { transition: none; } }
  `;

  // The notes in the corner use the card's colours, in light and dark.
  const NOTES_STYLE = `
    :host { --bg: #fff; --fg: #1d1d1f; --muted: #6e6e73; --border: #e3e3e8; --accent: #2f6fed; --danger: #c93a3a; }
    :host([data-theme="dark"]) { --bg: #1f1f22; --fg: #ececf0; --muted: #9a9aa2; --border: #38383d; --accent: #5b8cff; --danger: #ff7373; }
    @media (prefers-color-scheme: dark) {
      :host([data-theme="system"]) { --bg: #1f1f22; --fg: #ececf0; --muted: #9a9aa2; --border: #38383d; --accent: #5b8cff; --danger: #ff7373; }
    }
    .note { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; align-items: center; width: 300px; margin-top: 8px;
      padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--fg);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16); font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      animation: rise 160ms cubic-bezier(0.2, 0.8, 0.2, 1); }
    .note.error .text { color: var(--danger); }
    .progress { grid-column: 1 / -1; height: 4px; border-radius: 2px; background: var(--border); overflow: hidden; }
    .progress span { display: block; height: 100%; width: 0; background: var(--accent); transition: width 200ms; }
    .progress.unknown span { width: 30%; animation: slide 1.1s ease-in-out infinite; }
    button { all: unset; cursor: pointer; padding: 2px 6px; border-radius: 6px; color: var(--muted); }
    button:hover { color: var(--fg); background: var(--border); }
    button.action { color: var(--accent); font-weight: 600; }
    button:focus-visible { outline: 2px solid var(--accent); }
    @keyframes rise { from { opacity: 0; transform: translateY(4px); } }
    @keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
    @media (prefers-reduced-motion: reduce) { .note, .progress.unknown span { animation: none; } }
  `;

  let active = false;
  let layer = null;
  let notes = null;
  // The notes in the corner, by kind: "status" (getting ready), "notice" (permission), "hint", "error".
  const shown = {};
  let bubbles = [];
  let captureId = null;
  // Texts already read for the current capture, by the bubble's line ids, so an unchanged page
  // shows its text at once.
  const texts = new Map();
  // Increased by every page change, so results of an older scan are dropped.
  let generation = 0;
  let settleTimer = null;
  let flashTimer = null;
  let scanning = false;
  let rescan = false;
  // Whether a manga page is on screen.
  let reading = false;
  let watchTimer = null;

  async function send(type, payload = {}) {
    const response = await browser.runtime.sendMessage({ type, ...payload });
    if (!response?.ok) throw new Error(response?.error ?? "No response from the extension.");
    return response.data;
  }

  function siteEnabled(settings) {
    const { hostname } = location;
    return settings.imageTextSites.some((site) => hostname === site || hostname.endsWith(`.${site}`));
  }

  // The language of the text in the images, from the languages the user learns.
  function language() {
    const { learning } = LC.companion.settings;
    const pageLang = (document.documentElement.lang || "").slice(0, 2);
    return learning.includes("ko") && (pageLang === "ko" || !learning.includes("ja")) ? "ko" : "ja";
  }

  function element(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
  }

  // In fullscreen only the fullscreen element is rendered.
  function attach(node) {
    const container = document.fullscreenElement ?? document.documentElement;
    if (node.parentElement !== container) container.append(node);
  }

  // --- Bubbles -----------------------------------------------------------------------

  function ensureLayer() {
    if (!layer) {
      layer = document.createElement("language-companion-text-layer");
      // Just below the lookup card, which uses the highest z-index.
      layer.setAttribute("style", "all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;");
      layer.append(element("style", { textContent: LAYER_STYLE }));
    }
    attach(layer);
  }

  function clearBubbles() {
    bubbles = [];
    layer?.querySelectorAll("language-companion-bubble").forEach((node) => node.remove());
  }

  function showBubbles() {
    ensureLayer();
    for (const bubble of bubbles) {
      const { x, y, width, height } = bubble.box;
      bubble.node = document.createElement("language-companion-bubble");
      bubble.node.setAttribute("style", `left: ${x}px; top: ${y}px; width: ${width}px; height: ${height}px;`);
      bubble.node.title = "Read and translate (hold Ctrl or ⌘ to click the page)";
      layer.append(bubble.node);
      if (texts.has(bubble.key)) setText(bubble, texts.get(bubble.key));
    }
    // Outlines show briefly, then only on hover.
    layer.toggleAttribute("data-flash", bubbles.length > 0);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => layer?.removeAttribute("data-flash"), FLASH_MS);
    if (bubbles.length) showHintOnce();
  }

  function setText(bubble, text) {
    bubble.read = true;
    bubble.text = text;
    // Nothing readable: stray furigana or part of the drawing.
    if (!text) bubble.node?.remove();
  }

  // Lines of one speech bubble: neighbouring columns (vertical text) or rows (horizontal text).
  // Bubbles come in reading order, and so do their lines.
  function groupBubbles(lines) {
    const parent = lines.map((_, i) => i);
    const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        if (sameBubble(lines[i], lines[j])) parent[root(i)] = root(j);
      }
    }
    const groups = new Map();
    lines.forEach((line, i) => {
      if (!groups.has(root(i))) groups.set(root(i), []);
      groups.get(root(i)).push(line);
    });
    const result = [...groups.values()].map((group) => {
      // Vertical text reads in columns from right to left, horizontal text in rows from the top.
      group.sort((a, b) => (a.vertical ? b.box.x + b.box.width - (a.box.x + a.box.width) : a.box.y - b.box.y));
      const left = Math.min(...group.map((line) => line.box.x)) - BUBBLE_PADDING;
      const top = Math.min(...group.map((line) => line.box.y)) - BUBBLE_PADDING;
      const right = Math.max(...group.map((line) => line.box.x + line.box.width)) + BUBBLE_PADDING;
      const bottom = Math.max(...group.map((line) => line.box.y + line.box.height)) + BUBBLE_PADDING;
      const ids = group.map((line) => line.id);
      return { ids, key: ids.join(","), box: { x: left, y: top, width: right - left, height: bottom - top }, read: false, reading: null, text: "" };
    });
    return result.sort((a, b) => a.box.y - b.box.y || b.box.x - a.box.x);
  }

  function sameBubble(a, b) {
    if (a.vertical !== b.vertical) return false;
    const [along, alongSize, across, acrossSize] = a.vertical ? ["y", "height", "x", "width"] : ["x", "width", "y", "height"];
    const gap = Math.max(a.box[across], b.box[across]) - Math.min(a.box[across] + a.box[acrossSize], b.box[across] + b.box[acrossSize]);
    const overlap = Math.min(a.box[along] + a.box[alongSize], b.box[along] + b.box[alongSize]) - Math.max(a.box[along], b.box[along]);
    return gap < BUBBLE_GAP * Math.min(a.box[acrossSize], b.box[acrossSize]) && overlap > 0;
  }

  function readBubble(bubble) {
    if (bubble.read) return Promise.resolve();
    const capture = captureId;
    bubble.reading ??= send(MSG.OCR_READ, { captureId: capture, ids: bubble.ids }).then(({ text }) => {
      if (capture !== captureId) return;
      texts.set(bubble.key, text);
      if (bubbles.includes(bubble)) setText(bubble, text);
    });
    return bubble.reading;
  }

  // Reads every bubble ahead of time, in reading order. A bubble clicked before its turn is read next.
  async function readAll(scanned) {
    for (const bubble of [...bubbles]) {
      if (scanned !== generation) return;
      try {
        await readBubble(bubble);
      } catch (error) {
        if (error.message === "expired" && scanned === generation) pageChanged();
        return;
      }
    }
  }

  // Opens the card on a bubble; its text follows as soon as the bubble is read.
  async function openBubble(bubble) {
    for (const other of bubbles) other.node?.removeAttribute("data-open");
    bubble.node.setAttribute("data-open", "");
    const { x, y, width, height } = bubble.box;
    const view = await LC.companion.openSentence(
      { left: x, top: y, right: x + width, bottom: y + height },
      { lang: layer.lang, context: { pageUrl: location.href, pageTitle: document.title, tags: ["lc::manga"] } },
    );
    try {
      await readBubble(bubble);
      view.setText(bubble.text);
    } catch {
      view.setError("Couldn't read this bubble. Turn the page or scroll a little to try again.");
    }
  }

  // --- Notes in the corner -----------------------------------------------------------

  function ensureNotes() {
    if (!notes) {
      notes = document.createElement("language-companion-notes");
      notes.setAttribute("style", "all: initial; display: block; position: fixed; left: 12px; bottom: 12px; z-index: 2147483646;");
      const shadow = notes.attachShadow({ mode: "closed" });
      notes.list = document.createElement("div");
      shadow.append(element("style", { textContent: NOTES_STYLE }), notes.list);
    }
    notes.dataset.theme = LC.companion.settings.theme;
    attach(notes);
  }

  // Shows one note of a kind, replacing the previous one of that kind.
  // options: { error, progress (0–1, or null while unknown), action: [label, onClick], dismissible }
  function showNote(kind, text, { error = false, progress, action, dismissible = false } = {}) {
    ensureNotes();
    const node = element("div", { className: error ? "note error" : "note", role: error ? "alert" : "status" }, element("span", { className: "text", textContent: text }));
    const buttons = element("span");
    if (action) buttons.append(element("button", { className: "action", textContent: action[0], onclick: action[1] }));
    if (dismissible) buttons.append(element("button", { textContent: "✕", title: "Close", ariaLabel: "Close", onclick: () => hideNote(kind) }));
    node.append(buttons);
    if (progress !== undefined) {
      const bar = element("span");
      if (progress !== null) bar.style.width = `${Math.round(progress * 100)}%`;
      node.append(element("div", { className: progress === null ? "progress unknown" : "progress" }, bar));
    }
    shown[kind]?.remove();
    shown[kind] = node;
    notes.list.append(node);
  }

  function hideNote(kind) {
    shown[kind]?.remove();
    delete shown[kind];
  }

  function showPermissionNotice() {
    if (shown.notice) return;
    showNote("notice", "To read the text in these pages, click the Language Companion button in the toolbar and turn on “Read text in images”.", { dismissible: true });
  }

  // The first time bubbles show up anywhere, say what to do with them.
  async function showHintOnce() {
    const { [HINT_SEEN_KEY]: seen } = await browser.storage.local.get(HINT_SEEN_KEY);
    if (seen || shown.hint) return;
    await browser.storage.local.set({ [HINT_SEEN_KEY]: true });
    showNote("hint", "Click a speech bubble to read and translate it. Then click or drag across words to look them up.", { dismissible: true });
    setTimeout(() => hideNote("hint"), HINT_MS);
  }

  // Download progress of the models, sent by the background while it fetches them.
  function showProgress({ loaded, total }) {
    if (total && loaded >= total) return showNote("status", "Preparing text recognition…", { progress: null });
    const megabytes = (bytes) => Math.round(bytes / 1e6);
    const text = total ? `Downloading text recognition · ${megabytes(loaded)} of ${megabytes(total)} MB` : "Downloading text recognition…";
    showNote("status", text, { progress: total ? loaded / total : null });
  }

  // --- Scanning ----------------------------------------------------------------------

  // Elements that show a picture, including viewers that use a background image.
  function pictures() {
    const found = new Set(document.querySelectorAll("img, canvas, svg, iframe"));
    for (const x of [0.25, 0.5, 0.75]) {
      for (const y of [0.25, 0.5, 0.75]) {
        for (const node of document.elementsFromPoint(window.innerWidth * x, window.innerHeight * y)) {
          if (node !== document.body && node !== document.documentElement && getComputedStyle(node).backgroundImage.startsWith("url(")) found.add(node);
        }
      }
    }
    return found;
  }

  // The visible parts of the large pictures on screen, or nothing if they don't add up to a manga page.
  function pageRects() {
    const rects = [];
    let area = 0;
    for (const node of pictures()) {
      const box = node.getBoundingClientRect();
      if (box.width < MIN_PICTURE_SIDE || box.height < MIN_PICTURE_SIDE) continue;
      const left = Math.max(0, box.left);
      const top = Math.max(0, box.top);
      const right = Math.min(window.innerWidth, box.right);
      const bottom = Math.min(window.innerHeight, box.bottom);
      if (right <= left || bottom <= top) continue;
      rects.push({ left, top, right, bottom });
      area += (right - left) * (bottom - top);
    }
    return area >= MIN_PICTURES_SHARE * window.innerWidth * window.innerHeight ? rects : [];
  }

  function onPage({ box }, rects) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    return rects.some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
  }

  function onLink({ box }) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    return document.elementsFromPoint(x, y).some((node) => {
      const link = node.closest(LC.selection.CLICKABLE);
      if (!link) return false;
      const { width, height } = link.getBoundingClientRect();
      return width * height < MAX_LINK_SHARE * window.innerWidth * window.innerHeight;
    });
  }

  // Starts reading when a page appears, and stops when the user leaves it for the rest of the site.
  function watchPage() {
    if (!active || document.hidden) return;
    const shown = pageRects().length > 0;
    if (shown === reading) return;
    reading = shown;
    pageChanged();
  }

  function pageChanged() {
    generation += 1;
    clearBubbles();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(scan, SETTLE_MS);
  }

  // The extension's own UI isn't page text.
  function ownRects() {
    return [LC.companion.cardRect(), notes?.list.getBoundingClientRect()]
      .filter((rect) => rect && rect.width && rect.height)
      .map(({ left, top, right, bottom }) => ({ left, top, right, bottom }));
  }

  async function scan() {
    if (!active || document.hidden) return;
    const rects = pageRects();
    reading = rects.length > 0;
    if (!reading) return;
    if (scanning) {
      rescan = true;
      return;
    }
    scanning = true;
    const scanned = generation;
    const slow = setTimeout(() => !shown.status && showNote("status", "Getting text recognition ready…", { progress: null }), STATUS_DELAY_MS);
    try {
      const lang = language();
      const result = await send(MSG.OCR_SCAN, {
        lang,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        exclude: ownRects(),
      });
      hideNote("error");
      if (scanned !== generation) return;
      if (result.captureId !== captureId) texts.clear();
      captureId = result.captureId;
      ensureLayer();
      layer.lang = lang;
      bubbles = groupBubbles(result.lines.filter((line) => onPage(line, rects) && !onLink(line)));
      showBubbles();
      readAll(scanned);
    } catch (error) {
      if (error.message === "permission") showPermissionNotice();
      // The tab went to the background; it scans again once it's visible (visibilitychange).
      else if (error.message === "not-visible") return;
      else {
        console.warn("Language Companion: reading text in images failed:", error);
        showNote("error", `Couldn't read the text on this page. ${error.message}`, { error: true, action: ["Try again", () => pageChanged()], dismissible: true });
      }
    } finally {
      clearTimeout(slow);
      hideNote("status");
      scanning = false;
      if (rescan) {
        rescan = false;
        scan();
      }
    }
  }

  // --- Events ------------------------------------------------------------------------

  function inLayer(target) {
    return Boolean(layer && target instanceof Node && layer.contains(target));
  }

  // Capture on window, so the site's viewer never sees presses and clicks on bubbles (no page
  // turn, no swipe). Clicks are handled here, since the events stop here.
  for (const type of ["pointerdown", "mousedown", "touchstart", "pointerup", "mouseup", "touchend", "click", "dblclick"]) {
    window.addEventListener(
      type,
      (event) => {
        if (!active || !inLayer(event.target)) return;
        event.stopImmediatePropagation();
        if (type !== "click" || event.button !== 0) return;
        const bubble = bubbles.find((item) => item.node === event.target);
        // Only real clicks: a page script can't make the extension read its screen (see content.js).
        if (bubble && event.isTrusted) openBubble(bubble);
      },
      true,
    );
  }

  // Bubbles sit on top of the page. With Ctrl or Cmd held, clicks go to the page instead.
  function clickThrough(event) {
    if (event.isTrusted && (event.key === "Control" || event.key === "Meta")) layer?.toggleAttribute("data-through", event.type === "keydown");
  }
  window.addEventListener("keydown", clickThrough, true);
  window.addEventListener("keyup", clickThrough, true);
  window.addEventListener("blur", () => layer?.removeAttribute("data-through"));

  // Anything that may change what's on screen. Events on the extension's own UI don't count.
  function onPageEvent(event) {
    if (!event.isTrusted || !active || inLayer(event.target) || event.target === notes || LC.companion.contains(event.target)) return;
    if (event.type === "keydown" && !NAVIGATION_KEYS.includes(event.key)) return;
    pageChanged();
  }
  for (const type of ["wheel", "keydown", "click", "touchend"]) window.addEventListener(type, onPageEvent, true);
  document.addEventListener("scroll", onPageEvent, true);
  // A page can fire these itself too, which must not start a scan.
  window.addEventListener("resize", (event) => event.isTrusted && active && pageChanged());
  document.addEventListener("fullscreenchange", (event) => event.isTrusted && active && pageChanged());
  document.addEventListener("visibilitychange", (event) => event.isTrusted && active && !document.hidden && pageChanged());

  // --- Setup -------------------------------------------------------------------------

  function update() {
    const settings = LC.companion.settings;
    const enabled = Boolean(settings && LC.companion.enabledHere() && siteEnabled(settings));
    if (enabled === active) return;
    active = enabled;
    clearInterval(watchTimer);
    reading = false;
    if (active) {
      watchTimer = setInterval(watchPage, WATCH_MS);
      pageChanged();
    } else {
      generation += 1;
      layer?.remove();
      notes?.remove();
      layer = notes = null;
      for (const kind of Object.keys(shown)) delete shown[kind];
      bubbles = [];
    }
  }

  // content.js runs first, but wait for it and its settings in case script order ever changes.
  const startup = setInterval(() => {
    if (!LC.companion?.settings) return;
    clearInterval(startup);
    update();
    // The open bubble keeps its outline until the card closes.
    LC.companion.onClose(() => bubbles.forEach((bubble) => bubble.node?.removeAttribute("data-open")));
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      // content.js reloads the settings on the same event.
      setTimeout(() => {
        const wasActive = active;
        update();
        if (wasActive && active) pageChanged();
      }, 100);
    });
    browser.runtime.onMessage.addListener((message) => {
      if (!active) return;
      if (message?.type === MSG.OCR_PROGRESS) showProgress(message);
      // Sent by the background once the permission was granted, so no reload is needed.
      if (message?.type === MSG.IMAGE_TEXT_REFRESH) {
        hideNote("notice");
        pageChanged();
      }
    });
  }, 100);
})();
