import "../shared/languages.js";
import { translators, dictionaries, exampleSources } from "./providers/index.js";

const { languages } = globalThis.LC;

// Picks the source language: chosen on the card > known content language (e.g. the subtitle
// track) > writing system > detection > telltale letters > page language > English.
export async function resolveSourceLang(req, detectLanguage) {
  const requested = req.sourceLang && req.sourceLang !== "auto" ? req.sourceLang : null;
  const explicit = languages.normalize(requested) ?? languages.normalize(req.contentLang);
  if (explicit) return explicit;

  const text = req.sentence || req.text;
  const script = languages.byScript(req.text) ?? languages.byScript(text);
  if (script) return script;

  if (detectLanguage) {
    try {
      const detected = await detectLanguage(text);
      const supported = (detected?.languages ?? []).map((l) => languages.normalize(l.language)).find(Boolean);
      if (detected?.isReliable && supported) return supported;
    } catch {
      // Detection is best effort.
    }
  }
  return languages.byLetters(req.text) ?? languages.byLetters(text) ?? languages.normalize(req.pageLang) ?? "en";
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
  const src = await resolveSourceLang(req, ctx.detectLanguage);
  return { text: req.text.trim(), src, tgt: languages.target };
}

function errorsOf(results) {
  return results.filter((r) => r.status === "rejected").map((r) => r.reason?.message ?? String(r.reason));
}

// The card is split into two requests so it can show the translation (fast) without
// waiting for dictionaries and example sentences (slow, Wiktionary often takes seconds).
// `ctx` may contain { fetch, detectLanguage, cache: { get, set } }.
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

// IPA, audio, definitions and examples from every enabled provider, in parallel.
// A failing provider only adds an entry to `errors`.
export async function lookupDetails(req, settings, ctx = {}) {
  const { text, src, tgt } = await resolveLangs(req, settings, ctx);
  const empty = { ipa: "", reading: "", audioUrl: "", definitions: [], examples: [], errors: [] };
  if (isPhrase(text, src)) return empty;

  const cacheKey = ["details", src, tgt, text].join("|");
  const cached = await ctx.cache?.get(cacheKey);
  if (cached) return { ...cached, errors: [] };

  const enabled = (p) => settings.providers[p.id] !== false && p.supports(src, tgt);
  const providerReq = { text, src, tgt };
  const results = await Promise.allSettled(
    [...dictionaries, ...exampleSources].filter(enabled).map((p) => p.lookup(providerReq, settings, ctx)),
  );
  const errors = errorsOf(results);
  const details = merge(results.filter((r) => r.status === "fulfilled").map((r) => r.value), settings);
  // Only cache complete results, so a temporary outage does not stick for 30 days.
  if (!errors.length) await ctx.cache?.set(cacheKey, details);
  return { ...details, errors };
}

// Combines provider results. Earlier results win for single values; lists are concatenated.
export function merge(parts, settings) {
  const merged = { ipa: "", reading: "", audioUrl: "", definitions: [], examples: [] };
  for (const part of parts) {
    merged.ipa ||= part.ipa ?? "";
    merged.reading ||= part.reading ?? "";
    merged.audioUrl ||= part.audioUrl ?? "";
    // Definitions from the first dictionary that has any; mixing sources gets repetitive.
    if (!merged.definitions.length) merged.definitions = part.definitions ?? [];
    merged.examples.push(...(part.examples ?? []));
  }
  merged.definitions = merged.definitions.slice(0, settings.maxDefinitions);
  merged.examples = dedupeBy(merged.examples, (e) => e.text).slice(0, settings.maxExamples);
  return merged;
}

function dedupeBy(items, key) {
  const seen = new Set();
  return items.filter((item) => !seen.has(key(item)) && seen.add(key(item)));
}
