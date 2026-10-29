// Splits a Japanese word into parts with readings over the kanji only, e.g.
// 食べ物 + たべもの -> 食(た) べ 物(もの). Shared by the card and the Anki note.
(() => {
  const LC = (globalThis.LC ??= {});

  // CJK ideographs plus 々 (repeat mark), which is read like a kanji.
  const KANJI = /[一-鿿々]/;
  const RUNS = /[一-鿿々]+|[^一-鿿々]+/g;

  const toHiragana = (text) => text.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Returns [{ text, rt? }]. Kana between kanji anchors the split; if the reading does not
  // line up with the word (e.g. after editing), the whole word gets the whole reading.
  function segments(word, reading) {
    if (!word || !reading || !KANJI.test(word)) return [{ text: word }];
    const runs = word.match(RUNS);
    const pattern = runs.map((run) => (KANJI.test(run) ? "(.+?)" : `(${escapeRegex(toHiragana(run))})`)).join("");
    const match = new RegExp(`^${pattern}$`).exec(toHiragana(reading));
    if (!match) return [{ text: word, rt: reading }];
    return runs.map((run, i) => (KANJI.test(run) ? { text: run, rt: match[i + 1] } : { text: run }));
  }

  LC.furigana = Object.freeze({ segments, hasKanji: (text) => KANJI.test(text ?? "") });
})();
