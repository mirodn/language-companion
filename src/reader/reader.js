// The reader: the article of another page (found by extract.js), cleaned up, with every word
// clickable. That matters most for Japanese, where words have no spaces between them
// and are hard to select by hand. Click a word to look it up; Shift+click a second word to look up
// the phrase in between. Selecting text works as on any page (content.js).
(() => {
  const LC = globalThis.LC;
  const { languages } = LC;

  const ARTICLES_KEY = "readerArticles";
  const FONT_SIZE_KEY = "lc-reader-font-size";
  const FONT_SIZES = [16, 18, 20, 23, 26, 30];
  const WORD_CLASS = "w";

  const $ = (selector) => document.querySelector(selector);

  // --- Cleaning the article ---------------------------------------------------------------

  // Elements kept from the article; everything else is unwrapped (its text stays) or, for DROP,
  // removed with its content. Only plain markup survives, so nothing from the page can run here.
  const ALLOWED = new Set([
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "dl", "dt", "dd", "blockquote", "pre",
    "code", "em", "strong", "b", "i", "u", "s", "small", "sub", "sup", "mark", "q", "cite", "br", "hr",
    "a", "img", "figure", "figcaption", "table", "thead", "tbody", "tr", "th", "td", "ruby", "rt",
  ]);
  const DROP = new Set([
    "script", "style", "noscript", "template", "iframe", "object", "embed", "form", "input", "button",
    "select", "textarea", "svg", "math", "video", "audio", "canvas", "rp",
  ]);

  const isWebUrl = (url) => /^https?:/i.test(url ?? "");

  function clean(source) {
    const fragment = document.createDocumentFragment();
    for (const child of source.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        fragment.append(child.data);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.localName;
      if (DROP.has(tag)) continue;
      if (!ALLOWED.has(tag)) {
        fragment.append(clean(child));
        continue;
      }
      const el = document.createElement(tag);
      if (child.lang) el.lang = child.lang;
      if (tag === "rt") {
        // Shown by CSS from the attribute, so readings stay out of words and sentences.
        el.dataset.rt = child.textContent.trim();
        fragment.append(el);
        continue;
      }
      if (tag === "a" && isWebUrl(child.href)) {
        el.href = child.href;
        el.target = "_blank";
        el.rel = "noreferrer";
      }
      if (tag === "img") {
        if (!isWebUrl(child.src)) continue;
        el.src = child.src;
        el.alt = child.alt;
        el.loading = "lazy";
      }
      for (const name of ["colspan", "rowspan"]) {
        if (child.hasAttribute(name)) el.setAttribute(name, child.getAttribute(name));
      }
      el.append(clean(child));
      fragment.append(el);
    }
    return fragment;
  }

  // --- Clickable words ----------------------------------------------------------------------

  const BLOCK_SELECTOR = "p, li, dt, dd, blockquote, pre, h1, h2, h3, h4, h5, h6, figcaption, th, td, article";
  const segmenters = new Map();
  let nextWordId = 0;

  function segmenter(lang) {
    if (!segmenters.has(lang)) segmenters.set(lang, new Intl.Segmenter(lang || undefined, { granularity: "word" }));
    return segmenters.get(lang);
  }

  // Text nodes grouped by their block, so words are found in the whole paragraph's text: furigana
  // splits 行きます into <ruby>行<rt></ruby> and きます, but it is still one word.
  function textBlocks(root) {
    const blocks = new Map();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement.closest("pre, code")) continue;
      const block = node.parentElement.closest(BLOCK_SELECTOR) ?? root;
      if (!blocks.has(block)) blocks.set(block, []);
      blocks.get(block).push(node);
    }
    return blocks;
  }

  // Wraps every word in one of the user's languages in <span class="w" data-w="id">; a word spread
  // over several text nodes gets one span per node, all with the same id. Other words (English
  // names, numbers) stay plain text.
  function wrapWords(root, learning) {
    for (const [block, nodes] of textBlocks(root)) {
      const lang = block.closest("[lang]")?.lang ?? "";
      const text = nodes.map((node) => node.data).join("");
      const starts = [];
      nodes.reduce((offset, node) => (starts.push(offset), offset + node.data.length), 0);
      const pieces = nodes.map(() => []);

      for (const { segment, index, isWordLike } of segmenter(lang).segment(text)) {
        if (!isWordLike || !languages.isLearned(segment, learning)) continue;
        const id = String(nextWordId++);
        const end = index + segment.length;
        nodes.forEach((node, i) => {
          const from = Math.max(index, starts[i]);
          const to = Math.min(end, starts[i] + node.data.length);
          if (from < to) pieces[i].push({ from: from - starts[i], to: to - starts[i], id });
        });
      }

      nodes.forEach((node, i) => {
        if (!pieces[i].length) return;
        const fragment = document.createDocumentFragment();
        let at = 0;
        for (const { from, to, id } of pieces[i]) {
          if (from > at) fragment.append(node.data.slice(at, from));
          const span = document.createElement("span");
          span.className = WORD_CLASS;
          span.dataset.w = id;
          span.textContent = node.data.slice(from, to);
          fragment.append(span);
          at = to;
        }
        if (at < node.data.length) fragment.append(node.data.slice(at));
        node.replaceWith(fragment);
      });
    }
  }

  const wordAt = (target) => (target instanceof Element ? target.closest(`.${WORD_CLASS}`) : null);
  const partsOf = (word) => [...document.querySelectorAll(`.${WORD_CLASS}[data-w="${word.dataset.w}"]`)];

  // --- Lookup -------------------------------------------------------------------------------

  let article = null;
  let anchorWord = null;

  // The clicked word, or the phrase from the Shift+click anchor to it within the same block.
  function rangeFor(word, extend) {
    const range = document.createRange();
    const block = word.closest(BLOCK_SELECTOR);
    let first = word;
    let last = word;
    if (extend && anchorWord?.isConnected && anchorWord.closest(BLOCK_SELECTOR) === block) {
      const forward = anchorWord.compareDocumentPosition(word) & Node.DOCUMENT_POSITION_FOLLOWING;
      [first, last] = forward ? [anchorWord, word] : [word, anchorWord];
    }
    range.setStartBefore(partsOf(first)[0]);
    range.setEndAfter(partsOf(last).at(-1));
    return range;
  }

  function lookUp(word, extend) {
    const range = rangeFor(word, extend);
    if (!extend) anchorWord = word;
    LC.companion.lookup({
      ...LC.selection.fromRange(range),
      // Clicking a word looks it up, so the card offers the link it is part of.
      context: { pageUrl: article.url, pageTitle: article.title, tags: ["lc::reader"], link: word.closest("a[href]")?.href },
    });
  }

  // Shift+click would otherwise extend the browser's text selection.
  document.addEventListener("mousedown", (event) => {
    if (event.shiftKey && wordAt(event.target)) event.preventDefault();
  });

  document.addEventListener("click", (event) => {
    const word = wordAt(event.target);
    // Ctrl/Cmd+click still opens links; a drag selection is handled by content.js.
    if (!word || event.button !== 0 || event.ctrlKey || event.metaKey) return;
    if (!window.getSelection().isCollapsed) return;
    event.preventDefault();
    lookUp(word, event.shiftKey);
  });

  // Highlights all parts of a word that furigana splits up.
  for (const type of ["mouseover", "mouseout"]) {
    document.addEventListener(type, (event) => {
      const word = wordAt(event.target);
      if (word) partsOf(word).forEach((part) => part.classList.toggle("hover", type === "mouseover"));
    });
  }

  // --- Page -----------------------------------------------------------------------------------

  function readFontSize() {
    try {
      return Number(localStorage.getItem(FONT_SIZE_KEY)) || 20;
    } catch {
      return 20;
    }
  }

  function setFontSize(size) {
    document.documentElement.style.setProperty("--font-size", `${size}px`);
    try {
      localStorage.setItem(FONT_SIZE_KEY, String(size));
    } catch {
      // Only a convenience.
    }
  }

  function stepFontSize(step) {
    const current = FONT_SIZES.indexOf(readFontSize());
    const index = Math.max(0, Math.min(FONT_SIZES.length - 1, (current < 0 ? 2 : current) + step));
    setFontSize(FONT_SIZES[index]);
  }

  // The article's language: from its writing system (more reliable than the lang attribute, which
  // many sites leave at "en"), then the lang attribute.
  function articleLang(text) {
    return languages.byScript(text.slice(0, 2000)) ?? languages.normalize(article.lang) ?? article.lang ?? "";
  }

  async function init() {
    const settings = await LC.settings.getSettings();
    if (settings.theme !== "system") document.documentElement.dataset.theme = settings.theme;
    setFontSize(readFontSize());
    $("#smaller").addEventListener("click", () => stepFontSize(-1));
    $("#larger").addEventListener("click", () => stepFontSize(1));

    const id = location.hash.slice(1);
    const { [ARTICLES_KEY]: articles = {} } = await browser.storage.session.get(ARTICLES_KEY);
    article = articles[id];
    if (!article) {
      $("#article").classList.add("empty");
      $("#article").textContent =
        "This article is no longer available. Open the page again and choose “Open in reader”.";
      return;
    }

    document.title = article.title;
    $("#title").textContent = article.title;
    $("#byline").textContent = [article.byline, article.siteName].filter(Boolean).join(" · ");
    if (isWebUrl(article.url)) $("#original").href = article.url;
    $("#original").textContent = `← ${new URL(article.url).hostname}`;

    const body = clean(new DOMParser().parseFromString(article.html, "text/html").body);
    const lang = articleLang(body.textContent);
    document.querySelector("main").lang = lang;
    $("#article").replaceChildren(body);
    if (!settings.learning.includes(lang)) {
      const name = languages.get(lang) ? languages.name(lang) : "another language";
      $(".hint").textContent = `This article is in ${name}, which isn't one of your languages. You can change them in the settings.`;
      return;
    }
    wrapWords($("#title"), settings.learning);
    wrapWords($("#article"), settings.learning);
  }

  init();
})();
