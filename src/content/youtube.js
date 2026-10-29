// YouTube integration: makes the subtitles shown by the player clickable.
// Works on the rendered caption DOM, so auto-generated and auto-translated captions work too.
// Click a word to look it up; Shift+click a second word to look up the phrase in between.
// Optionally shows a translation of each subtitle line under it (dual subtitles).
(() => {
  const LC = globalThis.LC;

  const WORD_CLASS = "lc-yt-word";
  const CONTAINER_SELECTOR = ".ytp-caption-window-container";
  const SEGMENT_SELECTOR = ".ytp-caption-segment";
  // Delay before resuming, so a click on the video (which YouTube treats as play/pause) wins.
  const RESUME_DELAY_MS = 300;
  const TRANSLATION_CLASS = "lc-yt-translation";
  // Auto-generated subtitles grow word by word; only lines that stay this long are translated.
  const TRANSLATE_DELAY_MS = 600;
  const MAX_CACHED_LINES = 1000;

  let container = null;
  let observer = null;
  let anchorWord = null;
  let pausedByUs = false;
  const segmenters = new Map();
  // "lang|line" -> translation, or null while the request is running.
  const translations = new Map();
  const queuedLines = new Map();
  let translateTimer = null;

  function active() {
    const companion = LC.companion;
    return Boolean(companion?.settings?.youtubeEnabled && companion.enabledHere());
  }

  function video() {
    return document.querySelector("#movie_player video") ?? document.querySelector("video");
  }

  // Language of the selected caption track, read from the page's player API.
  // `wrappedJSObject` is Firefox's way for content scripts to reach page-defined functions.
  function captionLang() {
    try {
      const track = document.getElementById("movie_player")?.wrappedJSObject?.getOption?.("captions", "track");
      return track?.translationLanguage?.languageCode || track?.languageCode || "";
    } catch {
      return "";
    }
  }

  function segmenter(lang) {
    if (!segmenters.has(lang)) {
      segmenters.set(lang, new Intl.Segmenter(lang || undefined, { granularity: "word" }));
    }
    return segmenters.get(lang);
  }

  // --- Wrapping caption words --------------------------------------------------------

  function wrap(segment, lang) {
    const text = segment.textContent;
    if (segment.dataset.lcText === text) return;
    const fragment = document.createDocumentFragment();
    for (const { segment: part, isWordLike } of segmenter(lang).segment(text)) {
      if (isWordLike) {
        const span = document.createElement("span");
        span.className = WORD_CLASS;
        span.textContent = part;
        fragment.append(span);
      } else {
        fragment.append(part);
      }
    }
    // Marks the segment as processed; our own replaceChildren triggers the observer again.
    segment.dataset.lcText = text;
    segment.replaceChildren(fragment);
  }

  function wrapAll() {
    const lang = captionLang();
    container?.querySelectorAll(SEGMENT_SELECTOR).forEach((segment) => wrap(segment, lang));
  }

  function unwrapAll() {
    for (const segment of document.querySelectorAll(`${SEGMENT_SELECTOR}[data-lc-text]`)) {
      segment.textContent = segment.dataset.lcText;
      delete segment.dataset.lcText;
    }
    removeTranslations();
  }

  // --- Dual subtitles --------------------------------------------------------------------

  // The subtitle text of one caption window (or segment), without our translation line.
  function windowText(captionWindow) {
    const segments = captionWindow.matches(SEGMENT_SELECTOR) ? [captionWindow] : captionWindow.querySelectorAll(SEGMENT_SELECTOR);
    return [...segments]
      .map((segment) => segment.textContent)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function removeTranslations() {
    document.querySelectorAll(`.${TRANSLATION_CLASS}`).forEach((line) => line.remove());
  }

  function fill(line, translation, error = "") {
    line.textContent = error ? `Translation failed: ${error}` : translation;
    line.classList.toggle("lc-yt-error", Boolean(error));
    line.hidden = !line.textContent;
  }

  // Adds or updates the translation line under each caption window. Only writes to the DOM when
  // the subtitle changed, since our own changes trigger the observer again.
  function showTranslations() {
    const lang = captionLang();
    for (const captionWindow of container.querySelectorAll(".caption-window")) {
      const text = windowText(captionWindow);
      let line = captionWindow.querySelector(`.${TRANSLATION_CLASS}`);
      if (!text) {
        line?.remove();
        continue;
      }
      if (line?.dataset.for === text) continue;
      if (!line) {
        line = document.createElement("div");
        line.className = TRANSLATION_CLASS;
        captionWindow.append(line);
      }
      line.dataset.for = text;
      const size = parseFloat(getComputedStyle(captionWindow.querySelector(SEGMENT_SELECTOR)).fontSize);
      if (size) line.style.fontSize = `${Math.round(size * 0.8)}px`;
      const key = `${lang}|${text}`;
      fill(line, translations.get(key) ?? "");
      if (!translations.has(key)) queueTranslation(key, text, lang);
    }
  }

  function queueTranslation(key, text, lang) {
    queuedLines.set(key, { text, lang });
    clearTimeout(translateTimer);
    translateTimer = setTimeout(translateQueued, TRANSLATE_DELAY_MS);
  }

  function translateQueued() {
    const shown = new Set([...document.querySelectorAll(`.${TRANSLATION_CLASS}`)].map((line) => line.dataset.for));
    for (const [key, { text, lang }] of queuedLines) {
      // Skips lines that were already replaced, e.g. half-finished auto-generated ones.
      if (shown.has(text) && !translations.has(key)) translate(key, text, lang);
    }
    queuedLines.clear();
  }

  async function translate(key, text, lang) {
    translations.set(key, null);
    if (translations.size > MAX_CACHED_LINES) translations.delete(translations.keys().next().value);
    let translation = "";
    let error = "";
    try {
      const response = await browser.runtime.sendMessage({
        type: LC.MSG.TRANSLATE_LINE,
        text,
        contentLang: lang,
        pageLang: document.documentElement.lang,
      });
      if (response?.ok) translation = response.data.translation;
      else error = response?.error ?? "no response";
    } catch (e) {
      error = e.message;
    }
    // Failed lines are not retried; with a used-up quota, every retry would fail too.
    translations.set(key, translation);
    for (const line of document.querySelectorAll(`.${TRANSLATION_CLASS}`)) {
      if (line.dataset.for === text) fill(line, translation, error);
    }
  }

  function dualSubtitles() {
    return Boolean(LC.companion.settings.youtubeDualSubtitles);
  }

  function onCaptionsChanged() {
    wrapAll();
    if (dualSubtitles()) showTranslations();
  }

  // The player and its caption container are recreated on navigation, so check periodically.
  function tick() {
    if (!active()) {
      if (observer) {
        observer.disconnect();
        observer = null;
        container = null;
        unwrapAll();
      }
      return;
    }
    if (!dualSubtitles()) removeTranslations();
    if (container?.isConnected) return;

    observer?.disconnect();
    container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    observer = new MutationObserver(onCaptionsChanged);
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    onCaptionsChanged();
  }

  // --- Lookup --------------------------------------------------------------------------

  function wordFrom(target) {
    return target instanceof Element ? target.closest(`.${WORD_CLASS}`) : null;
  }

  // The whole caption currently on screen, i.e. the subtitle line.
  function captionText(word) {
    const captionWindow = word.closest(".caption-window") ?? word.closest(SEGMENT_SELECTOR);
    const lines = captionWindow.querySelectorAll(".caption-visual-line");
    // Without visual lines, read the segments so the translation line is left out.
    const text = lines.length ? [...lines].map((line) => line.textContent).join(" ") : windowText(captionWindow);
    return text.replace(/\s+/g, " ").trim();
  }

  // Range from the Shift+click anchor to `word` when both are in the same caption.
  function phraseRange(word, extend) {
    const range = document.createRange();
    const captionWindow = word.closest(".caption-window");
    const words = captionWindow ? [...captionWindow.querySelectorAll(`.${WORD_CLASS}`)] : [];
    const from = extend && anchorWord ? words.indexOf(anchorWord) : -1;
    const to = words.indexOf(word);
    if (from < 0 || to < 0) {
      range.selectNodeContents(word);
      return range;
    }
    range.setStartBefore(words[Math.min(from, to)]);
    range.setEndAfter(words[Math.max(from, to)]);
    return range;
  }

  function videoId() {
    const url = new URL(location.href);
    return url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/)?.[1] ?? null;
  }

  function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = String(seconds % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
  }

  // Source link pointing slightly before the click, so it replays the subtitle line.
  function videoContext(currentTime) {
    const id = videoId();
    const start = Math.max(0, Math.floor(currentTime) - 2);
    const title =
      document.querySelector("h1.ytd-watch-metadata, #title h1")?.textContent.trim() ||
      document.title.replace(/ - YouTube$/, "");
    return {
      pageUrl: id ? `https://www.youtube.com/watch?v=${id}&t=${start}s` : location.href,
      pageTitle: `${title} (${formatTime(start)})`,
      tags: ["lc::youtube"],
    };
  }

  function lookUp(word, extend) {
    const { settings } = LC.companion;
    const player = video();
    if (settings.youtubePauseOnClick && player && !player.paused) {
      player.pause();
      pausedByUs = true;
    }

    const range = phraseRange(word, extend);
    if (!extend) anchorWord = word;
    LC.companion.lookup({
      text: range.toString().replace(/\s+/g, " ").trim(),
      sentence: captionText(word),
      rect: range.getBoundingClientRect(),
      pageLang: document.documentElement.lang,
      contentLang: captionLang(),
      context: videoContext(player?.currentTime ?? 0),
    });
  }

  // Capture on window so YouTube never sees clicks on caption words (no drag, no play/pause).
  for (const type of ["pointerdown", "mousedown", "mouseup", "click", "dblclick"]) {
    window.addEventListener(
      type,
      (event) => {
        const word = wordFrom(event.target);
        if (!word || !active()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (type === "click" && event.button === 0) lookUp(word, event.shiftKey);
      },
      true,
    );
  }

  function onCardClosed() {
    anchorWord = null;
    if (!pausedByUs) return;
    pausedByUs = false;
    if (!LC.companion.settings.youtubeResumeOnClose) return;
    setTimeout(() => {
      const player = video();
      if (player?.paused) player.play();
    }, RESUME_DELAY_MS);
  }

  // content.js runs first, but wait for it in case script order ever changes.
  const startup = setInterval(() => {
    if (!LC.companion) return;
    clearInterval(startup);
    LC.companion.onClose(onCardClosed);
    tick();
    setInterval(tick, 1000);
  }, 100);
})();
