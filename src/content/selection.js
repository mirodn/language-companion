// Reads the current selection plus the sentence around it.
(() => {
  const LC = globalThis.LC;

  const BLOCK_SELECTOR =
    "p, li, td, th, dd, dt, blockquote, pre, h1, h2, h3, h4, h5, h6, figcaption, caption, article, section, div";
  const MAX_SENTENCE_LENGTH = 400;

  // Returns { text, sentence, rect, pageLang } or null if nothing usable is selected.
  function current(maxLength) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const text = selection.toString().replace(/\s+/g, " ").trim();
    if (!text || text.length > maxLength) return null;

    const range = selection.getRangeAt(0);
    const element = elementOf(range.startContainer);
    return {
      text,
      sentence: sentenceAround(range, element) || text,
      rect: range.getBoundingClientRect(),
      pageLang: element?.closest("[lang]")?.lang || document.documentElement.lang || "",
    };
  }

  function elementOf(node) {
    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  }

  function sentenceAround(range, element) {
    const block = element?.closest(BLOCK_SELECTOR) ?? element;
    if (!block) return "";

    // Offsets of the selection inside the block's text.
    const before = document.createRange();
    before.selectNodeContents(block);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    const end = start + range.toString().length;
    const full = block.textContent;

    let sentenceStart = 0;
    let sentenceEnd = full.length;
    const breaks = new RegExp(LC.languages.sentenceBreak.source, "g");
    for (const match of full.matchAll(breaks)) {
      const matchEnd = match.index + match[0].length;
      if (matchEnd <= start) {
        sentenceStart = matchEnd;
      } else if (match.index >= end) {
        sentenceEnd = match.index + match[0].trimEnd().length;
        break;
      }
    }

    let sentence = full.slice(sentenceStart, sentenceEnd);
    if (sentence.length > MAX_SENTENCE_LENGTH) {
      // Very long "sentences" (lists, tables, missing punctuation): keep a window around the selection.
      const from = Math.max(sentenceStart, start - MAX_SENTENCE_LENGTH / 2);
      sentence = full.slice(from, from + MAX_SENTENCE_LENGTH);
    }
    // Drops citation markers such as Wikipedia's "[1]" or "[citation needed]".
    return sentence
      .replace(/\[(?:\d+|[a-z]|citation needed)\]/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  LC.selection = { current };
})();
