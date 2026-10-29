import "../shared/languages.js";
import { translators, dictionaries, exampleSources } from "./providers/index.js";
import { frequencyLabel } from "./frequency.js";

const { languages } = globalThis.LC;

// Picks the source language: chosen on the card > known content language (e.g. the subtitle
// track) > writing system > detection > page language > English. `learning` (the user's languages)
// decides whether Han characters alone are Japanese or Chinese.
export async function resolveSourceLang(req, detectLanguage, learning = []) {
  const requested = req.sourceLang && req.sourceLang !== "auto" ? req.sourceLang : null;
  const explicit = languages.normalize(requested) ?? languages.normalize(req.contentLang);
  if (explicit) return explicit;

  const text = req.sentence || req.text;
  const script = languages.byScript([req.text, req.sentence], learning);
  if (script) return script;

  if (detectLanguage) {
    try {
      const detected = await detectLanguage(text);
      // Han characters can only be Japanese or Chinese, whatever language the sentence around them is in.
      const fits = (code) => code && (!languages.hasHan(req.text) || code === "ja" || code === "zh");
      const supported = (detected?.languages ?? []).map((l) => languages.normalize(l.language)).find(fits);
      if (detected?.isReliable && supported) return supported;
    } catch {
      // Detection is best effort.
    }
  }
  const page = languages.normalize(req.pageLang);
  if (page) return page;
  // Han characters without any other hint: the user's first of Japanese and Chinese.
  if (languages.hasHan(req.text)) return learning.find((code) => code === "ja" || code === "zh") ?? "ja";
  return "en";
}

// Dictionaries and example sources only know single words and short expressions, and the
// slow ones (Tatoeba) would hold up the card for nothing, so phrases are only translated.
export function isPhrase(text, src) {
  if (languages.get(src)?.cjk) return [...text].length > 12;
  return text.split(/\s+/).length > 3;
}

function pickTranslator(settings, src, tgt) {
  const chosen = translators.find((t) => t.id === settings.translator);
  return chosen?.supports(src, tgt) ? chosen : translators[0];
}

async function resolveLangs(req, settings, ctx) {
  const src = await resolveSourceLang(req, ctx.detectLanguage, settings.learning);
  return { text: req.text.trim(), src, tgt: languages.target };
}

function errorsOf(results) {
  return results.filter((r) => r.status === "rejected").map((r) => r.reason?.message ?? String(r.reason));
}

// The card is split into two requests so it can show the translation (fast) without
// waiting for dictionaries and example sentences (slow, Wiktionary often takes seconds).
// `ctx` may contain { fetch, detectLanguage, cache: { get, set }, frequency: { rank } }.
export async function lookupTranslation(req, settings, ctx = {}) {
  const { text, src, tgt } = await resolveLangs(req, settings, ctx);
  const translator = pickTranslator(settings, src, tgt);
  const needsTranslation = src !== tgt;
  const sentence = req.sentence && req.sentence !== text ? req.sentence : "";
  const translate = (input) =>
    needsTranslation ? translator.lookup({ text: input, src, tgt }, settings, ctx) : Promise.resolve({ translation: "" });

  const cacheKey = [translator.id, src, tgt, text].join("|");
  const cached = await ctx.cache?.get(cacheKey);
  const [wordResult, sentenceResult] = await Promise.allSettled([
    cached ? Promise.resolve(cached) : translate(text),
    sentence && settings.translateSentence ? translate(sentence) : Promise.resolve({ translation: "" }),
  ]);
  const translation = wordResult.status === "fulfilled" ? wordResult.value.translation : "";
  if (!cached && wordResult.status === "fulfilled") await ctx.cache?.set(cacheKey, { translation });

  return {
    word: text,
    sentence,
    sourceLang: src,
    targetLang: tgt,
    translator: translator.name,
    translation,
    sentenceTranslation: sentenceResult.status === "fulfilled" ? sentenceResult.value.translation : "",
    errors: errorsOf([wordResult, sentenceResult]),
  };
}

// IPA, audio, definitions, examples, base form and frequency from every enabled provider, in parallel.
// A failing provider only adds an entry to `errors`.
export async function lookupDetails(req, settings, ctx = {}) {
  const { text, src, tgt } = await resolveLangs(req, settings, ctx);
  const empty = { ipa: "", reading: "", audioUrl: "", definitions: [], examples: [], kanji: [], base: null, frequency: null, errors: [] };
  if (isPhrase(text, src)) return empty;

  const cacheKey = detailsKey(src, tgt, text);
  // Jisho's JLPT level counts as frequency too, so the setting is applied to cached results as well.
  const withFrequency = (details) => (settings.providers.frequency === false ? { ...details, frequency: null } : details);
  const cached = await ctx.cache?.get(cacheKey);
  if (cached) return withFrequency({ ...cached, errors: [] });

  const enabled = (p) => settings.providers[p.id] !== false && p.supports(src, tgt);
  const providerReq = { text, src, tgt };
  const results = await Promise.allSettled(
    [...dictionaries, ...exampleSources].filter(enabled).map((p) => p.lookup(providerReq, settings, ctx)),
  );
  const errors = errorsOf(results);
  const details = merge(results.filter((r) => r.status === "fulfilled").map((r) => r.value), settings);
  if (!details.frequency && ctx.frequency) {
    details.frequency = await frequencyOf(details.base?.word, text, src, ctx.frequency).catch(() => null);
  }
  // Only cache complete results, so a temporary outage does not stick for 30 days.
  if (!errors.length) await ctx.cache?.set(cacheKey, details);
  return withFrequency({ ...details, errors });
}

const detailsKey = (src, tgt, text) => ["details", 3, src, tgt, text].join("|");

// Reading and main meaning of one word for the quick peek: dictionaries only (example sentences are
// slow), reusing a cached full lookup when there is one, with the translator as a fallback.
export async function peekWord(req, settings, ctx = {}) {
  const { text, src, tgt } = await resolveLangs(req, settings, ctx);
  let details = await ctx.cache?.get(detailsKey(src, tgt, text));
  if (!details) {
    const enabled = (p) => settings.providers[p.id] !== false && p.supports(src, tgt);
    const results = await Promise.allSettled(dictionaries.filter(enabled).map((p) => p.lookup({ text, src, tgt }, settings, ctx)));
    details = merge(results.filter((r) => r.status === "fulfilled").map((r) => r.value), settings);
  }
  let meaning = details.definitions[0]?.text ?? "";
  if (!meaning && src !== tgt) meaning = (await lookupTranslation({ ...req, sentence: "" }, settings, ctx)).translation;
  return { word: text, reading: details.reading || details.ipa, base: details.base?.word ?? "", meaning, sourceLang: src };
}

// Combines provider results. Earlier results win for single values; lists are concatenated.
export function merge(parts, settings) {
  const merged = { ipa: "", reading: "", audioUrl: "", definitions: [], examples: [], kanji: [], base: null, frequency: null };
  for (const part of parts) {
    merged.ipa ||= part.ipa ?? "";
    merged.reading ||= part.reading ?? "";
    merged.audioUrl ||= part.audioUrl ?? "";
    merged.base ||= part.base ?? null;
    merged.frequency ||= part.frequency ?? null;
    if (!merged.kanji.length) merged.kanji = part.kanji ?? [];
    // Definitions from the first dictionary that has any; mixing sources gets repetitive.
    if (!merged.definitions.length) merged.definitions = part.definitions ?? [];
    merged.examples.push(...(part.examples ?? []));
  }
  merged.definitions = merged.definitions.slice(0, settings.maxDefinitions);
  merged.examples = dedupeBy(merged.examples, (e) => e.text).slice(0, settings.maxExamples);
  return merged;
}

// The better rank of the base word and the word as written: "chevaux" counts as common as
// "cheval", and an inflected form that is common on its own ("est") keeps its rank.
async function frequencyOf(baseWord, text, src, frequency) {
  const rank = await frequency.rank(src, text);
  const baseRank = baseWord ? await frequency.rank(src, baseWord) : null;
  // No list for this language, or neither word can be rated (see NO_RARE in frequency.js).
  if (rank == null && baseRank == null) return null;
  return frequencyLabel(Math.min(rank ?? Infinity, baseRank ?? Infinity));
}

function dedupeBy(items, key) {
  const seen = new Set();
  return items.filter((item) => !seen.has(key(item)) && seen.add(key(item)));
}
