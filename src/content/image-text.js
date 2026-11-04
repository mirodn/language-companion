// Reads text in images on manga and webtoon sites (settings.imageTextSites).
// The background captures the visible tab, finds the speech bubbles and reads them
// (background/ocr.js). This script outlines the bubbles; clicking one shows its text in a panel
// next to it, where words and sentences can be selected and looked up like any text, with the
// bubble as the sentence. The page is scanned again whenever it changes (page turn, scroll).
(() => {
  const LC = globalThis.LC;
  const { MSG } = LC;

  // Wait this long after the last page event before scanning, so page-turn animations are done.
  const SETTLE_MS = 600;
  // Show "getting ready" only when a scan is slow, which is mostly the first model download.
  const STATUS_DELAY_MS = 800;
  // Neighbouring lines closer than this share of their width (columns) or height (rows) form a bubble.
  const BUBBLE_GAP = 0.8;
  const BUBBLE_PADDING = 4;
  const PANEL_GAP = 10;
  // Keys that may turn the page or scroll. Others (card shortcuts like Enter or E) don't rescan.
  const NAVIGATION_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "];

  // The layer is regular DOM, not a shadow root, so the page's selection can reach the panel's
  // text. Page CSS can't style these tags; everything else is set here or inline.
  const STYLE = `
    language-companion-bubble { display: block; position: fixed; pointer-events: auto; cursor: pointer; border-radius: 6px; }
    language-companion-bubble:hover, language-companion-bubble[data-open] {
      background: rgba(47, 111, 237, 0.08); outline: 2px solid rgba(47, 111, 237, 0.55); }
    language-companion-panel { display: block; position: fixed; box-sizing: border-box; width: max-content; max-width: 340px;
      padding: 10px 12px; border: 1px solid #e3e3e8; border-radius: 10px; background: #fff; color: #1d1d1f;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.18); pointer-events: auto; font: 13px/1.4 system-ui, sans-serif; text-align: left; }
    language-companion-panel-head { display: flex; gap: 8px; align-items: center; color: #6e6e73; font-size: 12px; user-select: none; }
    language-companion-panel-head > :first-child { flex: 1; }
    language-companion-panel-close { cursor: pointer; padding: 0 4px; font-size: 16px; line-height: 1; }
    language-companion-panel-text { display: block; margin-top: 6px; font: 20px/1.6 system-ui, sans-serif;
      user-select: text; cursor: text; overflow-wrap: anywhere; }
    language-companion-panel-text[data-pending] { color: #6e6e73; font-size: 14px; user-select: none; }
    language-companion-panel-text ::selection, language-companion-panel-text::selection { background: rgba(47, 111, 237, 0.3); }
    language-companion-panel-translation { display: block; margin-top: 6px; padding-top: 6px; border-top: 1px solid #e3e3e8;
      font-size: 14px; color: #3a3a3f; }
    language-companion-panel-translation:empty { display: none; }
    @media (prefers-color-scheme: dark) {
      language-companion-panel { background: #1f1f22; color: #ececf0; border-color: #38383d; }
      language-companion-panel-head, language-companion-panel-text[data-pending] { color: #9a9aa2; }
      language-companion-panel-translation { color: #c7c7cc; border-color: #38383d; }
    }
  `;

  let active = false;
  let layer = null;
  let chips = null;
  let status = null;
  let notice = null;
  let panel = null;
  let bubbles = [];
  let captureId = null;
  // Texts already read for the current capture, by the bubble's line ids, so an unchanged page
  // shows its text at once.
  const texts = new Map();
  // Increased by every page change, so results of an older scan are dropped.
  let generation = 0;
  let settleTimer = null;
  let scanning = false;
  let rescan = false;
  // A selection drag that started in the panel, and one that has just ended.
  let dragging = false;
  let dragEnded = false;

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

  function element(tag, style = "") {
    const node = document.createElement(tag);
    if (style) node.setAttribute("style", style);
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
      layer = element(
        "language-companion-text-layer",
        // Just below the lookup card, which uses the highest z-index.
        "all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;",
      );
      const style = document.createElement("style");
      style.textContent = STYLE;
      layer.append(style);
    }
    attach(layer);
  }

  function clearBubbles() {
    closePanel();
    bubbles = [];
    layer?.querySelectorAll("language-companion-bubble").forEach((node) => node.remove());
  }

  function showBubbles() {
    ensureLayer();
    for (const bubble of bubbles) {
      const { x, y, width, height } = bubble.box;
      bubble.node = element("language-companion-bubble", `left: ${x}px; top: ${y}px; width: ${width}px; height: ${height}px;`);
      bubble.node.title = "Show the text";
      layer.append(bubble.node);
      if (texts.has(bubble.key)) setText(bubble, texts.get(bubble.key));
    }
  }

  function setText(bubble, text) {
    bubble.read = true;
    bubble.text = text;
    // Nothing readable: stray furigana or part of the drawing.
    if (!text) bubble.node?.remove();
    if (panel?.bubble === bubble) fillPanel();
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

  // --- Panel -------------------------------------------------------------------------

  function openPanel(bubble) {
    closePanel();
    ensureLayer();
    panel = element("language-companion-panel");
    panel.bubble = bubble;
    panel.lang = layer.lang;
    const head = element("language-companion-panel-head");
    const hint = element("span");
    hint.textContent = "Select words to look them up";
    const close = element("language-companion-panel-close");
    close.textContent = "×";
    close.title = "Close (Esc)";
    head.append(hint, close);
    panel.text = element("language-companion-panel-text");
    panel.translation = element("language-companion-panel-translation");
    panel.append(head, panel.text, panel.translation);
    layer.append(panel);
    bubble.node.dataset.open = "";
    fillPanel();
    readBubble(bubble).catch(() => {
      if (panel?.bubble === bubble) showPanelText("Couldn't read this bubble.", true);
    });
  }

  function fillPanel() {
    const { bubble } = panel;
    if (!bubble.read) showPanelText("Reading…", true);
    else if (!bubble.text) showPanelText("No text found here.", true);
    else {
      showPanelText(bubble.text, false);
      showTranslation(bubble);
    }
  }

  // The whole bubble, translated with the translator from the settings. Only for bubbles that are
  // opened, so paging through a chapter doesn't use up the translator's daily limit.
  async function showTranslation(bubble) {
    panel.translation.textContent = bubble.translated ?? "Translating…";
    if (bubble.translated !== undefined) return placePanel();
    placePanel();
    bubble.translating ??= send(MSG.LOOKUP, { text: bubble.text, sourceLang: panel.lang, pageLang: panel.lang })
      .then(({ translation }) => translation)
      .catch(() => "");
    const translated = await bubble.translating;
    bubble.translated = translated;
    if (panel?.bubble !== bubble) return;
    panel.translation.textContent = translated;
    placePanel();
  }

  function showPanelText(text, pending) {
    panel.text.textContent = text;
    panel.text.toggleAttribute("data-pending", pending);
    placePanel();
  }

  // Beside the bubble, on whichever side has room, and inside the window.
  function placePanel() {
    const { box } = panel.bubble;
    const { width, height } = panel.getBoundingClientRect();
    let left = box.x + box.width + PANEL_GAP;
    if (left + width > window.innerWidth - PANEL_GAP) left = box.x - PANEL_GAP - width;
    left = Math.max(PANEL_GAP, Math.min(left, window.innerWidth - width - PANEL_GAP));
    const top = Math.max(PANEL_GAP, Math.min(box.y, window.innerHeight - height - PANEL_GAP));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function closePanel() {
    if (!panel) return;
    delete panel.bubble.node?.dataset.open;
    panel.remove();
    panel = null;
  }

  // The selection in the panel, as selection.js would describe it, with the whole bubble as the sentence.
  function selectionInfo() {
    const selection = window.getSelection();
    if (!panel || !selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!panel.text.contains(range.startContainer)) return null;
    const lang = panel.lang;
    const text = lang === "ko" ? selection.toString().replace(/\s+/g, " ").trim() : selection.toString().replace(/\s+/g, "");
    if (!text || text.length > LC.companion.settings.maxSelectionLength) return null;
    return {
      text,
      sentence: panel.bubble.text,
      rect: range.getBoundingClientRect(),
      pageLang: lang,
      context: { pageUrl: location.href, pageTitle: document.title, tags: ["lc::manga"] },
    };
  }

  // --- Notes in the corner -----------------------------------------------------------

  function chip(text, { dismissible = false } = {}) {
    if (!chips) {
      chips = element("language-companion-image-text", "all: initial; position: fixed; left: 12px; bottom: 12px; z-index: 2147483646;");
      const shadow = chips.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = `
        .chip { display: flex; gap: 8px; align-items: flex-start; max-width: 320px; margin-top: 6px; padding: 6px 10px;
          border-radius: 8px; font: 12px/1.4 system-ui, sans-serif; color: #1d1d1f; background: #fff;
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2); }
        button { all: unset; cursor: pointer; padding: 0 4px; color: #6e6e73; }
      `;
      chips.list = document.createElement("div");
      shadow.append(style, chips.list);
    }
    attach(chips);
    const node = document.createElement("div");
    node.className = "chip";
    const label = document.createElement("span");
    label.textContent = text;
    node.append(label);
    if (dismissible) {
      const close = document.createElement("button");
      close.textContent = "×";
      close.title = "Close";
      close.addEventListener("click", () => {
        notice?.remove();
        notice = null;
      });
      node.append(close);
    }
    chips.list.append(node);
    return node;
  }

  function setStatus(text) {
    status?.remove();
    status = text ? chip(text) : null;
  }

  function showPermissionNotice() {
    if (notice) return;
    notice = chip("To read the text in these pages, click the Language Companion button in the toolbar and turn on “Read text in images on this site”.", { dismissible: true });
  }

  // --- Scanning ----------------------------------------------------------------------

  function pageChanged() {
    generation += 1;
    clearBubbles();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(scan, SETTLE_MS);
  }

  // The extension's own UI isn't page text.
  function ownRects() {
    return [LC.companion.cardRect(), status?.getBoundingClientRect(), notice?.getBoundingClientRect()]
      .filter(Boolean)
      .map(({ left, top, right, bottom }) => ({ left, top, right, bottom }));
  }

  async function scan() {
    if (!active || document.hidden) return;
    if (scanning) {
      rescan = true;
      return;
    }
    scanning = true;
    const scanned = generation;
    const slow = setTimeout(() => setStatus("Getting text recognition ready…"), STATUS_DELAY_MS);
    try {
      const lang = language();
      const result = await send(MSG.OCR_SCAN, {
        lang,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        exclude: ownRects(),
      });
      if (scanned !== generation) return;
      if (result.captureId !== captureId) texts.clear();
      captureId = result.captureId;
      ensureLayer();
      layer.lang = lang;
      bubbles = groupBubbles(result.lines);
      showBubbles();
      readAll(scanned);
    } catch (error) {
      if (error.message === "permission") showPermissionNotice();
      else console.warn("Language Companion: reading text in images failed:", error);
    } finally {
      clearTimeout(slow);
      setStatus("");
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

  // Capture on window, so the site's viewer never sees presses, drags and clicks on bubbles or
  // the panel (no page turn, no swipe). Default actions stay, so text in the panel can be selected.
  for (const type of ["pointerdown", "mousedown", "touchstart"]) {
    window.addEventListener(
      type,
      (event) => {
        if (!active || !inLayer(event.target)) return;
        event.stopImmediatePropagation();
        if (type === "pointerdown" && panel?.text.contains(event.target)) dragging = true;
      },
      true,
    );
  }
  for (const type of ["pointermove", "mousemove", "touchmove"]) {
    window.addEventListener(type, (event) => dragging && event.stopImmediatePropagation(), true);
  }
  for (const type of ["pointerup", "mouseup", "touchend", "click", "dblclick"]) {
    window.addEventListener(
      type,
      (event) => {
        // A drag that ends outside the panel still ends with a click, which isn't for the page.
        if (!active || (!dragging && !dragEnded && !inLayer(event.target))) return;
        event.stopImmediatePropagation();
        // The events stop here, so clicks are handled here rather than on the elements.
        if (type === "click" && !dragEnded) {
          const bubble = bubbles.find((item) => item.node === event.target);
          if (bubble) openPanel(bubble);
          else if (event.target.closest?.("language-companion-panel-close")) closePanel();
        }
        if (type !== "mouseup" || (!dragging && !panel?.text.contains(event.target))) return;
        dragging = false;
        dragEnded = true;
        // The selection is only final after the mouseup has been processed.
        setTimeout(() => {
          dragEnded = false;
          LC.companion.offerSelection(selectionInfo());
        }, 0);
      },
      true,
    );
  }

  window.addEventListener(
    "keydown",
    (event) => {
      // Esc closes the card first (content.js), then the panel.
      if (active && panel && event.key === "Escape" && !LC.companion.cardRect()) closePanel();
    },
    true,
  );

  // Anything that may change what's on screen. Events on the extension's own UI don't count.
  function onPageEvent(event) {
    if (!active || inLayer(event.target) || event.target === chips || LC.companion.contains(event.target)) return;
    if (event.type === "keydown" && !NAVIGATION_KEYS.includes(event.key)) return;
    pageChanged();
  }
  for (const type of ["wheel", "keydown", "click", "touchend"]) window.addEventListener(type, onPageEvent, true);
  document.addEventListener("scroll", onPageEvent, true);
  window.addEventListener("resize", () => active && pageChanged());
  document.addEventListener("fullscreenchange", () => active && pageChanged());
  document.addEventListener("visibilitychange", () => active && !document.hidden && pageChanged());

  // --- Setup -------------------------------------------------------------------------

  function update() {
    const settings = LC.companion.settings;
    const enabled = Boolean(settings && LC.companion.enabledHere() && siteEnabled(settings));
    if (enabled === active) return;
    active = enabled;
    if (active) pageChanged();
    else {
      generation += 1;
      layer?.remove();
      chips?.remove();
      layer = chips = status = notice = panel = null;
      bubbles = [];
    }
  }

  // content.js runs first, but wait for it and its settings in case script order ever changes.
  const startup = setInterval(() => {
    if (!LC.companion?.settings) return;
    clearInterval(startup);
    update();
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      // content.js reloads the settings on the same event.
      setTimeout(() => {
        const wasActive = active;
        update();
        if (wasActive && active) pageChanged();
      }, 100);
    });
    // Sent by the background once the permission was granted, so no reload is needed.
    browser.runtime.onMessage.addListener((message) => {
      if (message?.type !== MSG.IMAGE_TEXT_REFRESH) return;
      notice?.remove();
      notice = null;
      if (active) pageChanged();
    });
  }, 100);
})();
