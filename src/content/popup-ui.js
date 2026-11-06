// The in-page UI: a small trigger button and the lookup card, rendered in a closed shadow root
// so page styles cannot leak in. All provider text is set via textContent, never as HTML.
(() => {
  const LC = globalThis.LC;
  const { languages, furigana } = LC;

  const CARD_WIDTH = 360;
  const GAP = 8;
  // How far the pointer has to move before pressing the header becomes a drag.
  const DRAG_THRESHOLD = 4;

  // Minimal element builder: h("div", { class: "x", onClick }, child, "text").
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === "class") el.className = value;
      else if (key === "value" || key === "checked") el[key] = value;
      else el.setAttribute(key, value === true ? "" : value);
    }
    el.append(...children.flat().filter((child) => child != null && child !== false));
    return el;
  }

  // Line icons on a 16×16 grid, drawn with the current text colour.
  const ICONS = {
    speaker: ["M3 6h2.5L9 3v10l-3.5-3H3z", "M11.5 5.5a3.5 3.5 0 0 1 0 5", "M13.5 3.5a6.5 6.5 0 0 1 0 9"],
    close: ["M4 4l8 8", "M12 4l-8 8"],
    back: ["M10 3L5 8l5 5"],
    chevron: ["M4 6l4 4 4-4"],
    pin: ["M6 2h4l-.5 4 2.5 2.5H4L6.5 6z", "M8 8.5V14"],
    copy: ["M5.5 5.5h7v7h-7z", "M3.5 10.5v-7h7"],
    check: ["M3 8.5l3 3 7-7"],
    retry: ["M13 8a5 5 0 1 1-1.5-3.5", "M13 2.5v3h-3"],
    alert: ["M8 2l6.5 11.5h-13z", "M8 6.5v3", "M8 11.5h.01"],
  };

  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    for (const d of ICONS[name]) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    return svg;
  }

  // A button showing only an icon; the label is its tooltip and accessible name.
  function iconButton(name, label, onClick, className = "icon-button") {
    return h("button", { class: className, title: label, "aria-label": label, onClick }, icon(name));
  }

  // The word with furigana over its kanji when a reading is known.
  function withFurigana(word, reading) {
    return furigana.segments(word, reading).map(({ text, rt }) => (rt ? h("ruby", {}, text, h("rt", {}, rt)) : text));
  }

  // Renders `sentence` with the first occurrence of `word` wrapped in <mark>.
  function highlighted(sentence, word) {
    const index = word ? sentence.toLowerCase().indexOf(word.toLowerCase()) : -1;
    if (index < 0) return [sentence];
    return [sentence.slice(0, index), h("mark", {}, sentence.slice(index, index + word.length)), sentence.slice(index + word.length)];
  }

  class CompanionUI {
    // options: { showSentenceTranslation, anki }: anki adds choosing, editing and saving the note.
    // handlers: { onTrigger, onAdd, onOpenInAnki, onUseBaseForm, onDeckChange, onCardChanged, onClose }
    constructor({ css, theme, options = {}, handlers }) {
      this.handlers = handlers;
      this.options = options;
      this.state = null;
      this.anchor = null;
      // Where the user dragged the card, in viewport coordinates. Kept between lookups until the
      // card closes, so the card can be parked in one place while reading.
      this.pinned = null;
      // Whether the card shows everything (all definitions, kanji, examples). Kept between lookups.
      this.expanded = false;
      // A speech bubble's sentence view, kept while one of its words is shown, for the Back button.
      this.back = null;

      this.host = document.createElement("language-companion-root");
      this.host.setAttribute("style", "all: initial; position: absolute; top: 0; left: 0; z-index: 2147483647;");
      this.shadow = this.host.attachShadow({ mode: "closed" });

      this.trigger = h(
        "button",
        {
          class: "trigger",
          title: "Translate (Alt+Shift+L)",
          "aria-label": "Translate with Language Companion",
          hidden: true,
          // Keep the page selection when clicking the button.
          onMousedown: (event) => event.preventDefault(),
          onClick: () => this.handlers.onTrigger(),
        },
        "文A",
      );
      this.card = h("div", {
        class: "card",
        role: "dialog",
        "aria-label": "Language Companion",
        hidden: true,
        onPointerdown: (event) => this.startDrag(event),
        onDblclick: (event) => this.isDragHandle(event.target) && this.unpin(),
      });
      this.shadow.append(h("style", {}, css), this.trigger, this.card);
      this.setTheme(theme);
      this.attach();
    }

    // In fullscreen only the fullscreen element is rendered, so the UI has to live inside it.
    attach() {
      const container = document.fullscreenElement ?? document.documentElement;
      if (this.host.parentElement !== container) container.append(this.host);
    }

    // The visible area in the host's coordinate space.
    bounds() {
      const container = this.host.parentElement;
      if (container === document.documentElement) {
        return {
          left: window.scrollX,
          top: window.scrollY,
          right: window.scrollX + container.clientWidth,
          bottom: window.scrollY + window.innerHeight,
        };
      }
      return { left: 0, top: 0, right: container.clientWidth, bottom: container.clientHeight };
    }

    // Converts a viewport rect (getBoundingClientRect) to the host's coordinate space.
    toLocal(rect) {
      const container = this.host.parentElement;
      const origin =
        container === document.documentElement
          ? { left: -window.scrollX, top: -window.scrollY }
          : container.getBoundingClientRect();
      return {
        left: rect.left - origin.left,
        right: rect.right - origin.left,
        top: rect.top - origin.top,
        bottom: rect.bottom - origin.top,
      };
    }

    get isOpen() {
      return Boolean(this.state);
    }

    get isEditing() {
      return Boolean(this.state?.editing);
    }

    // A pinned card stays open on clicks outside it; only Close or Esc close it.
    get isPinned() {
      return Boolean(this.state && this.pinned);
    }

    contains(target) {
      return target === this.host;
    }

    setTheme(theme) {
      this.host.dataset.theme = theme;
    }

    setOptions(options) {
      this.options = options;
      this.render();
    }

    destroy() {
      this.host.remove();
    }

    // --- Trigger ---------------------------------------------------------------

    showTrigger(rect) {
      this.attach();
      this.trigger.hidden = false;
      const local = this.toLocal(rect);
      const left = Math.min(local.right + 4, this.bounds().right - 36);
      const top = local.bottom + 4;
      this.trigger.style.left = `${left}px`;
      this.trigger.style.top = `${top}px`;
    }

    hideTrigger() {
      this.trigger.hidden = true;
    }

    // --- Card state ------------------------------------------------------------

    // context: optional { pageUrl, pageTitle, tags } overriding the current page, e.g. a video timestamp.
    // fromSentence: the word was picked in the speech bubble view, which stays reachable via Back
    // and keeps the card where it is.
    open(rect, word, context = {}, { fromSentence = false } = {}) {
      this.hideTrigger();
      this.attach();
      if (fromSentence) {
        if (this.state?.kind === "sentence") this.back = this.state;
      } else {
        this.back = null;
        this.anchor = this.toLocal(rect);
      }
      this.show();
      this.state = {
        kind: "word",
        context,
        status: "loading",
        word,
        result: null,
        error: "",
        editing: false,
        sentenceTranslationShown: false,
        selectedDefinitions: new Set(),
        selectedExample: 0,
        decks: [],
        deck: "",
        anki: { state: "idle", message: "" },
      };
      this.render();
    }

    // Shows the card, with a short entrance when it wasn't open yet.
    show() {
      if (!this.card.hidden) return;
      this.card.hidden = false;
      this.card.classList.remove("enter");
      void this.card.offsetWidth;
      this.card.classList.add("enter");
    }

    // The text of a speech bubble (image-text.js), whose words can be picked for the word view.
    // Its text and translation arrive later via the setters below, which take the returned view:
    // by then the card may show another bubble, or one of this bubble's words.
    openSentence(rect, { lang, context = {} }) {
      this.hideTrigger();
      this.attach();
      this.back = null;
      this.anchor = this.toLocal(rect);
      this.show();
      this.state = { kind: "sentence", lang, context, text: "", status: "loading", error: "", translation: null, selection: null };
      this.render();
      return this.state;
    }

    setSentenceText(view, text) {
      Object.assign(view, text ? { text, status: "ready", tokens: null } : { status: "error", error: "No text found in this bubble." });
      if (this.state === view) this.render();
    }

    setSentenceTranslation(view, translation) {
      view.translation = translation;
      if (this.state === view) this.render();
    }

    setSentenceError(view, message) {
      Object.assign(view, { status: "error", error: message });
      if (this.state === view) this.render();
    }

    get sentenceShown() {
      return this.state?.kind === "sentence";
    }

    // Back from a word to the speech bubble it was picked from.
    goBack() {
      if (!this.back) return;
      this.state = this.back;
      this.back = null;
      this.render();
    }

    close() {
      if (!this.state) return;
      this.state = null;
      this.back = null;
      this.pinned = null;
      this.card.hidden = true;
      this.card.replaceChildren();
      this.handlers.onClose?.();
    }

    // The translation part of a lookup; details follow via setDetails.
    setResult(result) {
      if (!this.state) return;
      Object.assign(this.state, {
        status: "ready",
        detailsLoading: true,
        result: { ipa: "", reading: "", audioUrl: "", definitions: [], examples: [], kanji: [], ...result },
        selectedExample: -1,
      });
      this.render();
    }

    setDetails(details) {
      if (!this.state?.result) return;
      const { result } = this.state;
      // The pronunciation may already have been edited.
      result.ipa ||= details.ipa ?? "";
      result.reading ||= details.reading ?? "";
      result.audioUrl = details.audioUrl ?? "";
      result.base = details.base ?? null;
      result.kanji = details.kanji ?? [];
      result.frequency = details.frequency ?? null;
      result.definitions = details.definitions ?? [];
      result.examples = details.examples ?? [];
      result.errors = [...result.errors, ...(details.errors ?? [])];
      Object.assign(this.state, {
        detailsLoading: false,
        // Pre-select the top definition; more can be ticked under "More".
        selectedDefinitions: new Set(result.definitions.length ? [0] : []),
        selectedExample: result.examples.length ? 0 : -1,
      });
      this.render();
    }

    setLookupError(message) {
      if (!this.state) return;
      Object.assign(this.state, { status: "error", error: message });
      this.render();
    }

    setDecks(decks, current) {
      if (!this.state) return;
      this.state.decks = decks.includes(current) ? decks : [current, ...decks];
      this.state.deck = current;
      this.render();
    }

    // state: idle | checking | ready | duplicate | adding | added | error
    //        offline (Anki closed, adding saves the note for later) | queued (saved for later)
    setAnkiState(state, message = "") {
      if (!this.state) return;
      this.state.anki = { state, message };
      this.render();
    }

    // The data that goes to Anki, including the user's edits and selections.
    getCard() {
      const { result, selectedDefinitions, selectedExample, deck } = this.state;
      return {
        word: result.word,
        translation: result.translation,
        definitions: result.definitions.filter((_, i) => selectedDefinitions.has(i)).map((d) => d.text),
        ipa: result.ipa,
        reading: result.reading,
        audioUrl: result.audioUrl,
        // The word as it appeared in the sentence, when the base form is saved instead.
        surface: result.surface ?? "",
        sentence: result.sentence,
        sentenceTranslation: result.sentenceTranslation,
        frequency: result.frequency?.label ?? "",
        kanji: result.kanji.map(({ character, meanings }) => ({ character, meanings })),
        example: result.examples[selectedExample] ?? null,
        pageUrl: this.state.context.pageUrl ?? location.href,
        pageTitle: this.state.context.pageTitle ?? document.title,
        tags: this.state.context.tags ?? [],
        sourceLang: result.sourceLang,
        targetLang: result.targetLang,
        deck,
      };
    }

    // --- Actions ---------------------------------------------------------------

    canAdd() {
      const { status, detailsLoading, anki } = this.state ?? {};
      return status === "ready" && !detailsLoading && !["adding", "added", "queued", "duplicate", "checking"].includes(anki.state);
    }

    add() {
      if (this.canAdd()) this.handlers.onAdd(this.getCard());
    }

    // Looks up and saves the base form (courir) instead of the inflected word (courait).
    useBaseForm() {
      const base = this.state?.result?.base;
      if (base && !this.state.editing) this.handlers.onUseBaseForm(base.word);
    }

    playAudio() {
      const result = this.state?.result;
      if (!result) return;
      const speak = () => {
        const utterance = new SpeechSynthesisUtterance(result.word);
        utterance.lang = result.sourceLang;
        speechSynthesis.cancel();
        speechSynthesis.speak(utterance);
      };
      if (!result.audioUrl) return speak();
      // Fall back to local text-to-speech if the page's CSP blocks the audio file.
      new Audio(result.audioUrl).play().catch(speak);
    }

    toggleExpanded() {
      if (this.state?.status !== "ready" || this.state.editing) return;
      this.expanded = !this.expanded;
      this.render();
    }

    // The sentence translation starts hidden, so the sentence can be tried first.
    showSentenceTranslation() {
      if (!this.state?.result?.sentenceTranslation) return;
      this.state.sentenceTranslationShown = true;
      this.render();
    }

    toggleEdit() {
      if (this.state?.status !== "ready") return;
      this.state.editing = !this.state.editing;
      this.render();
      if (this.state.editing) this.card.querySelector("input")?.focus();
      // The word may have changed, so the duplicate check has to run again.
      else this.handlers.onCardChanged(this.getCard());
    }

    // Keyboard shortcuts while the card is open. Returns true if the key was handled.
    handleKey(event) {
      if (!this.state || event.ctrlKey || event.metaKey || event.altKey) return false;
      const focused = this.shadow.activeElement;
      const typing = focused && ["INPUT", "TEXTAREA", "SELECT"].includes(focused.tagName);

      if (event.key === "Escape") {
        if (this.state.editing) this.toggleEdit();
        else this.close();
        return true;
      }
      if (this.state.kind === "sentence") return false;
      if (event.key === "Backspace" && this.back && !typing) {
        this.goBack();
        return true;
      }
      if (event.key === "Enter" && this.options.anki && !["TEXTAREA", "SELECT", "BUTTON", "A"].includes(focused?.tagName)) {
        this.add();
        return true;
      }
      if (typing) return false;
      if (event.key === "p" || event.key === "P") {
        this.playAudio();
        return true;
      }
      if ((event.key === "e" || event.key === "E") && this.options.anki) {
        this.toggleEdit();
        return true;
      }
      if ((event.key === "b" || event.key === "B") && this.state.result?.base) {
        this.useBaseForm();
        return true;
      }
      if (event.key === "m" || event.key === "M") {
        this.toggleExpanded();
        return true;
      }
      if ((event.key === "t" || event.key === "T") && this.state.result?.sentenceTranslation) {
        this.showSentenceTranslation();
        return true;
      }
      return false;
    }

    // --- Rendering -------------------------------------------------------------

    render() {
      const s = this.state;
      if (!s) return;
      const body =
        s.kind === "sentence"
          ? this.renderSentenceView()
          : s.status === "loading"
            ? this.renderLoading()
            : s.status === "error"
              ? this.renderError()
              : s.editing
                ? this.renderEditor()
                : this.renderResult();
      const footer = s.kind === "word" && s.status === "ready" && (this.options.anki ? this.renderFooter() : this.renderHints());
      this.card.replaceChildren(...[...body, footer].flat().filter((child) => child != null && child !== false));
      this.position();
    }

    closeButton() {
      return iconButton("close", "Close (Esc)", () => this.close());
    }

    // The header row, which also moves the card: Back (in a bubble's word), the title, Pin and Close.
    renderHeader(...title) {
      const pin = iconButton(
        "pin",
        this.pinned ? "Unpin: the card follows the text again" : "Pin the card here: it stays open and in place while you read",
        () => this.togglePin(),
        this.pinned ? "icon-button pin pinned" : "icon-button pin",
      );
      pin.setAttribute("aria-pressed", String(Boolean(this.pinned)));
      return h(
        "div",
        { class: "header", title: "Drag to move the card" },
        this.back && iconButton("back", "Back to the speech bubble (Backspace)", () => this.goBack()),
        h("div", { class: "title" }, title),
        pin,
        this.closeButton(),
      );
    }

    // A small icon button that copies text and briefly shows a check mark.
    copyButton(text, label) {
      const button = iconButton("copy", label, async () => {
        try {
          await navigator.clipboard.writeText(text);
          button.replaceChildren(icon("check"));
          setTimeout(() => button.replaceChildren(icon("copy")), 1200);
        } catch {
          // The page may not allow the clipboard; nothing else to do.
        }
      }, "icon-button small");
      return button;
    }

    // The word right away, and placeholders where the translation and definition will be.
    renderLoading() {
      return [
        this.renderHeader(h("div", { class: "word", lang: this.state.result?.sourceLang }, this.state.word)),
        h("div", { class: "skeleton", "aria-label": "Looking up…", role: "status" }, h("span", { class: "bar wide" }), h("span", { class: "bar" }), h("span", { class: "bar short" })),
      ];
    }

    renderError() {
      return [
        this.renderHeader(h("div", { class: "word" }, this.state.word)),
        h(
          "div",
          { class: "problem", role: "alert" },
          icon("alert"),
          h("span", {}, this.state.error),
        ),
        this.handlers.onRetry && h("button", { class: "button", onClick: () => this.handlers.onRetry() }, icon("retry"), " Try again"),
      ];
    }

    // Compact by default: word, reading, translation, the definitions that will be saved and the
    // sentence. "More" shows the rest: all definitions to choose from, kanji, examples.
    renderResult() {
      const { result } = this.state;
      const translation = result.translation || (result.sourceLang === result.targetLang ? "" : "—");
      return [
        this.renderHeader(
          h("div", { class: "word", lang: result.sourceLang }, withFurigana(result.word, result.reading)),
          iconButton("speaker", "Listen (P)", () => this.playAudio()),
        ),
        h("div", { class: "meta" }, this.renderLanguage(), this.renderFrequency(), result.ipa && h("span", { class: "ipa" }, result.ipa)),
        this.renderBaseForm(),
        translation && h("div", { class: "translation" }, h("span", {}, translation), translation !== "—" && this.copyButton(translation, "Copy the translation")),
        this.state.detailsLoading && h("div", { class: "skeleton compact", "aria-label": "Loading definitions…", role: "status" }, h("span", { class: "bar" }), h("span", { class: "bar short" })),
        this.expanded ? this.renderDefinitionChoices() : this.renderSelectedDefinitions(),
        this.renderSentence(),
        this.expanded && [this.renderKanji(), this.renderExamples(), this.renderWarnings()],
        this.renderMoreToggle(),
      ];
    }

    // Keyboard hints for the card without Anki, which has no other footer.
    renderHints() {
      const hints = [["M", this.expanded ? "less" : "more"], ["P", "listen"], this.state.result.base && ["B", "base form"], this.back && ["⌫", "back"], ["Esc", "close"]];
      return h(
        "div",
        { class: "hints" },
        hints.filter(Boolean).map(([key, action]) => h("span", {}, h("kbd", {}, key), ` ${action}`)),
      );
    }

    // --- Speech bubble view ----------------------------------------------------

    // A bubble's text as words to pick from (click, drag across, Shift+click to extend), and its
    // translation. Picked words open the word view; Back returns here.
    renderSentenceView() {
      const s = this.state;
      const header = this.renderHeader(h("span", { class: "label" }, "Speech bubble"), h("span", { class: "lang" }, languages.name(s.lang)));
      if (s.status === "loading") {
        return [header, h("div", { class: "skeleton", "aria-label": "Reading the bubble…", role: "status" }, h("span", { class: "bar wide" }), h("span", { class: "bar" }))];
      }
      if (s.status === "error") return [header, h("div", { class: "problem", role: "alert" }, icon("alert"), h("span", {}, s.error))];
      s.tokens ??= languages.segmentWords(s.text, s.lang);
      const tokens = h(
        "div",
        { class: "tokens", lang: s.lang, onPointerdown: (event) => this.startPicking(event) },
        s.tokens.map((token, i) => h("span", { class: token.isWord ? "token word-token" : "token", "data-i": String(i) }, token.text)),
      );
      this.tokensElement = tokens;
      this.highlightPick();
      return [
        header,
        tokens,
        h(
          "div",
          { class: "sentence-translation" },
          s.translation === null
            ? h("span", { class: "skeleton inline", "aria-label": "Translating…", role: "status" }, h("span", { class: "bar" }))
            : [h("span", {}, s.translation || "No translation available."), s.translation && this.copyButton(s.translation, "Copy the translation")],
        ),
        h("div", { class: "hints" }, h("span", {}, "Click a word, or drag across words for a phrase. ", h("kbd", {}, "Shift"), " + click extends it.")),
      ];
    }

    // Picks a word, or a run of words while the pointer is dragged across them.
    startPicking(event) {
      const index = this.tokenIndexAt(event.target);
      if (index === null || event.button !== 0) return;
      event.preventDefault();
      const s = this.state;
      const anchor = event.shiftKey && s.selection ? s.selection.anchor : index;
      s.selection = { anchor, from: Math.min(anchor, index), to: Math.max(anchor, index) };
      this.highlightPick();
      const element = this.tokensElement;
      element.setPointerCapture(event.pointerId);
      const move = (moveEvent) => {
        const at = this.tokenIndexAt(this.shadow.elementFromPoint(moveEvent.clientX, moveEvent.clientY));
        if (at === null) return;
        s.selection = { anchor, from: Math.min(anchor, at), to: Math.max(anchor, at) };
        this.highlightPick();
      };
      const end = () => {
        element.removeEventListener("pointermove", move);
        element.removeEventListener("pointerup", end);
        element.removeEventListener("pointercancel", end);
        const text = s.tokens.slice(s.selection.from, s.selection.to + 1).map((token) => token.text).join("").trim();
        if (text && this.state === s) this.handlers.onSentenceSelect?.({ text, sentence: s.text, lang: s.lang, context: s.context });
      };
      element.addEventListener("pointermove", move);
      element.addEventListener("pointerup", end);
      element.addEventListener("pointercancel", end);
    }

    tokenIndexAt(target) {
      const token = target?.closest?.(".token");
      return token ? Number(token.dataset.i) : null;
    }

    highlightPick() {
      const selection = this.state?.selection;
      for (const token of this.tokensElement?.children ?? []) {
        const i = Number(token.dataset.i);
        token.classList.toggle("picked", Boolean(selection) && i >= selection.from && i <= selection.to);
      }
    }

    // The definitions that go on the card, as plain text.
    renderSelectedDefinitions() {
      const { result, selectedDefinitions } = this.state;
      const selected = result.definitions.filter((_, i) => selectedDefinitions.has(i));
      if (!selected.length) return null;
      return h(
        "div",
        { class: "definitions" },
        selected.map((def) => h("div", { class: "definition" }, def.pos && h("span", { class: "pos" }, def.pos), def.text)),
      );
    }

    renderDefinitionChoices() {
      const { result, selectedDefinitions } = this.state;
      if (!result.definitions.length) return null;
      // Without Anki there is nothing to choose for: just the list.
      if (!this.options.anki) {
        return h(
          "div",
          { class: "section definitions" },
          h("div", { class: "label" }, "Definitions"),
          result.definitions.map((def) => h("div", { class: "definition" }, def.pos && h("span", { class: "pos" }, def.pos), def.text)),
        );
      }
      return h(
        "div",
        { class: "section" },
        h("div", { class: "label" }, "Definitions"),
        result.definitions.map((def, i) =>
          h(
            "label",
            { class: "option" },
            h("input", {
              type: "checkbox",
              checked: selectedDefinitions.has(i),
              onChange: (event) => (event.target.checked ? selectedDefinitions.add(i) : selectedDefinitions.delete(i)),
            }),
            h("span", {}, def.pos && h("span", { class: "pos" }, def.pos), def.text),
          ),
        ),
      );
    }

    renderSentence() {
      const { result, sentenceTranslationShown } = this.state;
      if (!result.sentence) return null;
      const translation = result.sentenceTranslation;
      const shown = sentenceTranslationShown || this.options.showSentenceTranslation;
      return h(
        "div",
        { class: "sentence-block" },
        h("div", { class: "sentence", lang: result.sourceLang }, highlighted(result.sentence, result.surface || result.word)),
        translation &&
          (shown
            ? h("div", { class: "sentence-translation" }, h("span", {}, translation), this.copyButton(translation, "Copy the sentence translation"))
            : h("button", { class: "reveal", title: "Show the sentence translation (T)", onClick: () => this.showSentenceTranslation() }, "Show translation")),
      );
    }

    renderExamples() {
      const { result, selectedExample } = this.state;
      if (!result.examples.length) return null;
      if (!this.options.anki) {
        return h(
          "div",
          { class: "section" },
          h("div", { class: "label" }, result.examples.length === 1 ? "Example" : "Examples"),
          result.examples.map((example) =>
            h("div", { class: "example" }, example.text, example.translation && h("span", { class: "muted block" }, example.translation)),
          ),
        );
      }
      return h(
        "div",
        { class: "section" },
        h("div", { class: "label" }, "Example"),
        result.examples.map((example, i) =>
          h(
            "label",
            { class: "option" },
            h("input", {
              type: "radio",
              name: "example",
              checked: selectedExample === i,
              // Clicking the selected example again deselects it.
              onClick: (event) => {
                this.state.selectedExample = this.state.selectedExample === i ? -1 : i;
                event.target.checked = this.state.selectedExample === i;
              },
            }),
            h("span", {}, example.text, example.translation && h("span", { class: "muted block" }, example.translation)),
          ),
        ),
      );
    }

    // "More: 3 definitions · kanji · 2 examples", only when there is something more to show.
    renderMoreToggle() {
      const { result, selectedDefinitions, detailsLoading } = this.state;
      if (detailsLoading) return null;
      const otherDefinitions = result.definitions.length - selectedDefinitions.size;
      const parts = [
        otherDefinitions > 0 && `${otherDefinitions} definition${otherDefinitions === 1 ? "" : "s"}`,
        result.kanji.length > 0 && "kanji",
        result.examples.length > 0 && `${result.examples.length} example${result.examples.length === 1 ? "" : "s"}`,
      ].filter(Boolean);
      if (!this.expanded && !parts.length) return null;
      return h(
        "button",
        { class: "more", "aria-expanded": String(this.expanded), title: "Show more or less (M)", onClick: () => this.toggleExpanded() },
        h("span", {}, this.expanded ? "Less" : `More: ${parts.join(" · ")}`),
        icon("chevron"),
      );
    }

    // Failures worth knowing about, e.g. a wrong DeepL key. Timeouts (Tatoeba is often slow) are
    // left out: there is nothing to do about them, and the card is complete without examples.
    renderWarnings() {
      const errors = this.state.result.errors.filter((error) => !/timed out/i.test(error));
      if (!errors.length) return null;
      return h("div", { class: "warnings", title: errors.join("\n") }, `Some sources failed: ${errors.join("; ")}`);
    }

    // 学 study; learning  ガク · まな.ぶ — one row per kanji of a Japanese word.
    renderKanji() {
      const { kanji } = this.state.result;
      if (!kanji.length) return null;
      return h(
        "div",
        { class: "section" },
        h("div", { class: "label" }, "Kanji"),
        kanji.map(({ character, meanings, on, kun }) =>
          h(
            "div",
            { class: "kanji" },
            h("span", { class: "kanji-char", lang: "ja" }, character),
            h("span", {}, meanings, (on || kun) && h("span", { class: "muted", lang: "ja" }, `  ${[on, kun].filter(Boolean).join(" · ")}`)),
          ),
        ),
      );
    }

    renderFrequency() {
      const { frequency } = this.state.result;
      if (!frequency) return null;
      const title = frequency.rank
        ? `#${frequency.rank.toLocaleString()} among the most common words in movie subtitles`
        : frequency.label === "Rare"
          ? "Not among the 20,000 most common words in movie subtitles"
          : frequency.label === "Common"
            ? "Marked as a common word by Jisho"
            : "JLPT level, N5 is the easiest";
      return h("span", { class: "freq", title }, frequency.label);
    }

    // "Base form: courir · third-person singular imperfect indicative" for an inflected word,
    // or where the word came from after switching to its base form.
    renderBaseForm() {
      const { result } = this.state;
      if (result.surface) return h("div", { class: "base muted" }, `Base form of “${result.surface}”`);
      if (!result.base || result.base.word === result.word) return null;
      // Wiktionary's "plural of cheval", without the "of cheval" part.
      const grammar = (result.base.formOf ?? "").replace(/\s+of\s.*$/, "");
      return h(
        "div",
        { class: "base" },
        h("span", { class: "muted" }, "Base form: "),
        h("button", { class: "link", title: "Look up the base form instead (B)", onClick: () => this.useBaseForm() }, result.base.word),
        grammar && h("span", { class: "muted" }, ` · ${grammar}`),
      );
    }

    // The word's language as a quiet label.
    renderLanguage() {
      return h("span", { class: "lang" }, languages.name(this.state.result.sourceLang));
    }

    renderEditor() {
      const { result } = this.state;
      const field = (label, key, multiline = false) =>
        h(
          "label",
          { class: "field" },
          h("span", { class: "label" }, label),
          h(multiline ? "textarea" : "input", { value: result[key] ?? "", rows: multiline ? 3 : null, onInput: (event) => (result[key] = event.target.value) }),
        );
      return [
        this.renderHeader(h("div", { class: "word" }, "Edit card")),
        field("Word", "word"),
        field("Translation", "translation"),
        result.sourceLang === "ja" ? field("Reading (furigana)", "reading") : field("Pronunciation", "ipa"),
        field("Sentence", "sentence", true),
        field("Sentence translation", "sentenceTranslation", true),
      ];
    }

    renderFooter() {
      const { decks, deck, anki, editing } = this.state;
      const status = {
        checking: h("span", { class: "muted" }, "Checking Anki…"),
        duplicate: h(
          "span",
          { class: "muted" },
          "Already in deck · ",
          h("a", { href: "#", onClick: (event) => (event.preventDefault(), this.handlers.onOpenInAnki(this.getCard())) }, "Open in Anki"),
        ),
        added: h("span", { class: "success" }, "✓ Added to Anki"),
        offline: h("span", { class: "muted", title: "The note is added as soon as Anki is open." }, "Anki is closed"),
        queued: h("span", { class: "success", title: "The note is added as soon as Anki is open." }, "✓ Saved for later"),
        error: h("span", { class: "error", title: anki.message }, anki.message),
      }[anki.state];

      return h(
        "div",
        { class: "footer" },
        decks.length > 0 &&
          h(
            "select",
            {
              class: "deck",
              title: "Deck",
              onChange: (event) => {
                this.state.deck = event.target.value;
                this.handlers.onDeckChange(this.getCard());
              },
            },
            decks.map((name) => h("option", { value: name, selected: name === deck }, name)),
          ),
        h("span", { class: "status" }, status),
        h("button", { class: "button", title: editing ? "Done editing (E)" : "Edit fields (E)", onClick: () => this.toggleEdit() }, editing ? "Done" : "Edit"),
        h(
          "button",
          { class: "button primary", title: "Add to Anki (Enter)", disabled: !this.canAdd(), onClick: () => this.add() },
          anki.state === "adding" ? "Adding…" : ["offline", "queued"].includes(anki.state) ? "Save for later" : "Add to Anki",
        ),
      );
    }

    // --- Dragging --------------------------------------------------------------

    // The header moves the card, except for its buttons and other controls.
    isDragHandle(target) {
      return Boolean(target.closest?.(".header") && !target.closest("button, a, input, select, textarea"));
    }

    startDrag(event) {
      if (event.button !== 0 || !this.isDragHandle(event.target)) return;
      const rect = this.card.getBoundingClientRect();
      const start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      const move = (moveEvent) => {
        const dx = moveEvent.clientX - start.x;
        const dy = moveEvent.clientY - start.y;
        if (!this.card.classList.contains("dragging") && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        this.card.classList.add("dragging");
        this.pinned = { left: start.left + dx, top: start.top + dy };
        this.position();
      };
      const end = () => {
        // A moved card is pinned, which the pin button shows.
        if (this.card.classList.contains("dragging")) this.render();
        this.card.classList.remove("dragging");
        this.card.removeEventListener("pointermove", move);
        this.card.removeEventListener("pointerup", end);
        this.card.removeEventListener("pointercancel", end);
      };
      this.card.setPointerCapture(event.pointerId);
      this.card.addEventListener("pointermove", move);
      this.card.addEventListener("pointerup", end);
      this.card.addEventListener("pointercancel", end);
    }

    // Back to its place next to the selection.
    unpin() {
      this.pinned = null;
      this.render();
    }

    // Pins the card where it is now, or lets it follow the text again.
    togglePin() {
      if (this.pinned) return this.unpin();
      const { left, top } = this.card.getBoundingClientRect();
      this.pinned = { left, top };
      this.render();
    }

    // Places the card where the user dragged it, or else below the selection (above it if there
    // is no room below).
    position() {
      if (this.pinned) return this.positionPinned();
      this.card.style.position = "";
      if (!this.anchor) return;
      const height = this.card.offsetHeight;
      const bounds = this.bounds();
      let top = this.anchor.bottom + GAP;
      if (top + height > bounds.bottom && this.anchor.top - GAP - height >= bounds.top) {
        top = this.anchor.top - GAP - height;
      }
      const maxLeft = bounds.right - CARD_WIDTH - GAP;
      const left = Math.max(bounds.left + GAP, Math.min(this.anchor.left, maxLeft));
      this.card.style.top = `${top}px`;
      this.card.style.left = `${left}px`;
    }

    // A dragged card stays at the same spot on screen while the page scrolls, and inside the window.
    positionPinned() {
      const left = Math.max(GAP, Math.min(this.pinned.left, window.innerWidth - this.card.offsetWidth - GAP));
      const top = Math.max(GAP, Math.min(this.pinned.top, window.innerHeight - this.card.offsetHeight - GAP));
      // In fullscreen the host lives in the fullscreen element, which fills the screen.
      const onPage = this.host.parentElement === document.documentElement;
      const local = onPage ? { left, top } : this.toLocal({ left, top, right: left, bottom: top });
      this.card.style.position = onPage ? "fixed" : "";
      this.card.style.top = `${local.top}px`;
      this.card.style.left = `${local.left}px`;
    }
  }

  LC.CompanionUI = CompanionUI;
})();
