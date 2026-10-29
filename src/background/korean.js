// Finding the dictionary form of a Korean word: nouns without their particle (학교에 → 학교) and
// verbs/adjectives without their ending (갔어요 → 가다). The rules only propose candidates;
// the Wiktionary provider tries them and keeps the first one that has an entry.

// Common particles, longest first so 에서 wins over 서. Only tried when the word as written has no
// entry, since some words end in the same syllables (아이 "child" is not 아 + 이).
const PARTICLES = [
  "에서는", "에게서", "으로는", "에서", "에게", "한테", "으로", "부터", "까지", "처럼", "보다", "에는", "에도",
  "하고", "이랑", "은", "는", "이", "가", "을", "를", "에", "와", "과", "도", "의", "로", "만", "랑",
];

export function stripParticle(word) {
  const particle = PARTICLES.find((p) => word.length > p.length && word.endsWith(p));
  return particle ? { word: word.slice(0, -particle.length), particle } : null;
}

// --- Hangul syllables ----------------------------------------------------------------------------

const FIRST = 0xac00;
const LAST = 0xd7a3;
// Vowel (medial) and final consonant indices used below.
const V = { a: 0, ae: 1, eo: 4, yeo: 6, o: 8, wa: 9, wae: 10, oe: 11, u: 13, wo: 14, eu: 18, i: 20 };
const F = { none: 0, n: 4, l: 8, b: 17, ss: 20 };

function split(syllable) {
  const code = syllable.charCodeAt(0);
  if (code < FIRST || code > LAST) return null;
  const n = code - FIRST;
  return { initial: Math.floor(n / 588), vowel: Math.floor((n % 588) / 28), final: n % 28 };
}

const join = ({ initial, vowel, final }) => String.fromCharCode(FIRST + initial * 588 + vowel * 28 + final);

// --- Endings ----------------------------------------------------------------------------------------

// What may follow the stem, by what the stem's last syllable absorbed: nothing, the past marker
// 았/었/였 (갔 = 가 + 았), ㅂ of ㅂ니다 (합 = 하 + ㅂ), ㄴ of ㄴ다/ㄴ (간 = 가 + ㄴ), or ㄹ (갈 = 가 + ㄹ).
const AFTER_STEM = new Set([
  "다", "요", "어요", "아요", "여요", "어", "아", "여", "어서", "아서", "여서", "습니다", "습니까", "고", "지", "지만", "지요", "죠",
  "게", "기", "면", "으면", "니까", "으니까", "는", "은", "을", "는다", "는데", "은데", "네요", "세요", "으세요", "십니다",
  "었다", "았다", "였다", "었어요", "았어요", "였어요", "었어", "았어", "였어",
  "었습니다", "았습니다", "였습니다", "었고", "았고", "었는데", "았는데", "겠다", "겠어요", "겠습니다", "고요",
]);
const AFTER_PAST = new Set(["다", "어요", "어", "습니다", "습니까", "고", "는데", "지만", "지요", "죠", "네요", "을", "으면", "던"]);
const AFTER_B = new Set(["니다", "니까"]);
const AFTER_N = new Set(["다", "데", ""]);
const AFTER_L = new Set(["", "게요", "까요", "거예요", "래요", "게", "까"]);
// Stem vowels that merge with 아/어: 봐 = 보 + 아, 해 = 하 + 여, 쳐 = 치 + 어, 써 = 쓰 + 어 …
const MERGED = new Map([
  [V.wa, [V.o]],
  [V.wo, [V.u]],
  [V.wae, [V.oe]],
  [V.ae, [V.a]],
  [V.yeo, [V.i]],
  [V.eo, [V.eu, V.eo]],
  [V.a, [V.eu, V.a]],
]);

// Possible stems for the stem's last syllable, each with the endings that may follow it.
function stemSyllables(syllable) {
  const parts = split(syllable);
  if (!parts) return [];
  const options = [{ syllable, endings: AFTER_STEM }];
  const withFinal = (final) => join({ ...parts, final });
  const merged = (MERGED.get(parts.vowel) ?? []).map((vowel) => join({ ...parts, vowel, final: F.none }));

  if (parts.final === F.none) {
    // 해요, 봐요: the ending's 아/어 merged into the stem.
    merged.forEach((stem) => options.push({ syllable: stem, endings: new Set(["", "요", "서", "도", "야"]) }));
  }
  if (parts.final === F.ss) {
    // 갔, 했, 봤: the past marker merged into the stem.
    options.push({ syllable: withFinal(F.none), endings: AFTER_PAST });
    merged.forEach((stem) => options.push({ syllable: stem, endings: AFTER_PAST }));
  }
  if (parts.final === F.b) options.push({ syllable: withFinal(F.none), endings: AFTER_B });
  if (parts.final === F.n) options.push({ syllable: withFinal(F.none), endings: AFTER_N });
  if (parts.final === F.l) options.push({ syllable: withFinal(F.none), endings: AFTER_L });
  return options;
}

// Dictionary forms (…다) the word could be a conjugation of, most likely first: shorter stems,
// i.e. longer endings, come first, and an unchanged stem before a merged one (있어요 is 있다, not 이다).
// The honorific past 셨 is left out on purpose: 마셨어요 would otherwise suggest 마다 before 마시다.
export function verbCandidates(word) {
  if (!split(word.at(-1))) return [];
  const candidates = [];
  for (let k = 1; k <= word.length; k++) {
    const rest = word.slice(k);
    for (const option of stemSyllables(word[k - 1])) {
      // A stem with nothing after it needs to have absorbed something (갈, 해).
      if (!option.endings.has(rest) || (!rest && option.syllable === word[k - 1])) continue;
      candidates.push(`${word.slice(0, k - 1)}${option.syllable}다`);
    }
    // ㅂ-irregular adjectives: 어려워요 = 어렵 + 어요 (워 replaces the ㅂ).
    if (k >= 2 && word[k - 1] === "워" && ["요", "", "서", "도"].includes(rest)) {
      const before = split(word[k - 2]);
      if (before?.final === F.none) candidates.push(`${word.slice(0, k - 2)}${join({ ...before, final: F.b })}다`);
    }
  }
  return [...new Set(candidates)].filter((candidate) => candidate !== word);
}
