// The in-page UI: a small trigger button and the lookup card, rendered in a closed shadow root
// so page styles cannot leak in. All provider text is set via textContent, never as HTML.
(() => {
  const LC = globalThis.LC;
  const { languages, furigana } = LC;

  const CARD_WIDTH = 360;
  const GAP = 8;

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
    // handlers: { onTrigger, onAdd, onOpenInAnki, onSourceLangChange, onDeckChange, onCardChanged, onClose }
    constructor({ css, theme, handlers }) {
      this.handlers = handlers;
      this.state = null;
      this.anchor = null;

      this.host = document.createElement("language-companion-root");
      this.host.setAttribute("style", "all: initial; position: absolute; top: 0; left: 0; z-index: 2147483647;");
      this.shadow = this.host.attachShadow({ mode: "closed" });

      this.trigger = h(
        "button",
        {
          class: "trigger",
          title: "Look up with Language Companion",
          hidden: true,
          // Keep the page selection when clicking the button.
          onMousedown: (event) => event.preventDefault(),
          onClick: () => this.handlers.onTrigger(),
        },
        "文A",
      );
      this.card = h("div", { class: "card", role: "dialog", "aria-label": "Language Companion", hidden: true });
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

    contains(target) {
      return target === this.host;
    }

    setTheme(theme) {
      this.host.dataset.theme = theme;
    }

    destroy() {
      this.host.remove();
    }

    // --- Trigger ---------------------------------------------------------------

    showTrigger(rect) {
      this.attach();
      this.trigger.hidden = false;
      const local = this.toLocal(rect);
      const left = Math.min(local.right + 4, this.bounds().right - 32);
      const top = local.bottom + 4;
      this.trigger.style.left = `${left}px`;
      this.trigger.style.top = `${top}px`;
    }

    hideTrigger() {
      this.trigger.hidden = true;
    }

    // --- Card state ------------------------------------------------------------

    // context: optional { pageUrl, pageTitle, tags } overriding the current page, e.g. a video timestamp.
    open(rect, word, context = {}) {
      this.hideTrigger();
      this.attach();
      this.anchor = this.toLocal(rect);
      this.state = {
        context,
        status: "loading",
        word,
        result: null,
        error: "",
        editing: false,
        selectedDefinitions: new Set(),
        selectedExample: 0,
        decks: [],
        deck: "",
        anki: { state: "idle", message: "" },
      };
      this.card.hidden = false;
      this.render();
    }

    close() {
      if (!this.state) return;
      this.state = null;
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
        result: { ipa: "", reading: "", audioUrl: "", definitions: [], examples: [], ...result },
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
      result.definitions = details.definitions ?? [];
      result.examples = details.examples ?? [];
      result.errors = [...result.errors, ...(details.errors ?? [])];
      Object.assign(this.state, {
        detailsLoading: false,
        // Pre-select the first two definitions; that is usually enough on a card.
        selectedDefinitions: new Set(result.definitions.slice(0, 2).map((_, i) => i)),
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
        sentence: result.sentence,
        sentenceTranslation: result.sentenceTranslation,
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
      return status === "ready" && !detailsLoading && !["adding", "added", "duplicate", "checking"].includes(anki.state);
    }

    add() {
      if (this.canAdd()) this.handlers.onAdd(this.getCard());
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
      if (event.key === "Enter" && !["TEXTAREA", "SELECT", "BUTTON", "A"].includes(focused?.tagName)) {
        this.add();
        return true;
      }
      if (typing) return false;
      if (event.key === "p" || event.key === "P") {
        this.playAudio();
        return true;
      }
      if (event.key === "e" || event.key === "E") {
        this.toggleEdit();
        return true;
      }
      return false;
    }

    // --- Rendering -------------------------------------------------------------

    render() {
      const s = this.state;
      if (!s) return;
      const body =
        s.status === "loading"
          ? [h("div", { class: "header" }, h("div", { class: "word" }, s.word), this.closeButton()), h("div", { class: "loading" }, "Looking up…")]
          : s.status === "error"
            ? [h("div", { class: "header" }, h("div", { class: "word" }, s.word), this.closeButton()), h("div", { class: "error" }, s.error)]
            : s.editing
              ? this.renderEditor()
              : this.renderResult();
      this.card.replaceChildren(
        ...[...body, s.status === "ready" && this.renderFooter()].filter((child) => child != null && child !== false),
      );
      this.position();
    }

    closeButton() {
      return h("button", { class: "icon-button", title: "Close (Esc)", onClick: () => this.close() }, "×");
    }

    renderResult() {
      const { result, selectedDefinitions, selectedExample } = this.state;
      return [
        h(
          "div",
          { class: "header" },
          h("div", { class: "word" }, withFurigana(result.word, result.reading)),
          result.ipa && h("span", { class: "ipa" }, result.ipa),
          h("button", { class: "icon-button", title: "Pronounce (P)", onClick: () => this.playAudio() }, "🔊"),
          h("span", { class: "spacer" }),
          this.renderLanguageSelect(),
          this.closeButton(),
        ),
        h("div", { class: "translation" }, result.translation || (result.sourceLang === result.targetLang ? "" : "—")),
        result.sentence &&
          h(
            "div",
            { class: "section" },
            h("div", { class: "sentence" }, highlighted(result.sentence, result.word)),
            result.sentenceTranslation && h("div", { class: "muted" }, result.sentenceTranslation),
          ),
        this.state.detailsLoading && h("div", { class: "loading" }, "Loading definitions…"),
        result.definitions.length > 0 &&
          h(
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
          ),
        result.examples.length > 0 &&
          h(
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
          ),
        result.errors.length > 0 && h("div", { class: "warnings", title: result.errors.join("\n") }, `Some sources failed: ${result.errors.join("; ")}`),
      ];
    }

    // Source language (detected, can be corrected) → English.
    renderLanguageSelect() {
      const { result } = this.state;
      return h(
        "span",
        { class: "langs" },
        h(
          "select",
          {
            class: "lang",
            title: `Detected language: ${languages.name(result.sourceLang)}. Change it if the guess is wrong.`,
            onChange: (event) => this.handlers.onSourceLangChange(event.target.value),
          },
          languages.list.map((lang) => h("option", { value: lang.code, selected: lang.code === result.sourceLang }, lang.code.toUpperCase())),
        ),
        h("span", { class: "muted" }, `→ ${result.targetLang.toUpperCase()}`),
      );
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
        h("div", { class: "header" }, h("div", { class: "word" }, "Edit card"), h("span", { class: "spacer" }), this.closeButton()),
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
          anki.state === "adding" ? "Adding…" : "Add to Anki",
        ),
      );
    }

    // Places the card below the selection, or above it if there is no room below.
    position() {
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
  }

  LC.CompanionUI = CompanionUI;
})();
