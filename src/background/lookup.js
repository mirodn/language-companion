import "../shared/languages.js";
import { translators, dictionaries, exampleSources } from "./providers/index.js";

const { languages } = globalThis.LC;

// Picks the source language: explicit request > setting > detection > page lang > English.
export async function resolveSourceLang(req, settings, detectLanguage) {
  const requested = req.sourceLang && req.sourceLang !== "auto" ? req.sourceLang : settings.sourceLang;
  const explicit = languages.normalize(requested);
  if (explicit) return explicit;

  if (detectLanguage) {
    try {
      const detected = await detectLanguage(req.sentence || req.text);
      const top = languages.normalize(detected?.languages?.[0]?.language);
      if (detected?.isReliable && top) return top;
    } catch {
      // Detection is best effort.
    }
  }
  return languages.normalize(req.pageLang) ?? "en";
}

function pickTranslator(settings, src, tgt) {
  const chosen = translators.find((t) => t.id === settings.translator);
  return chosen?.supports(src, tgt) ? chosen : translators[0];
}

// Runs every enabled provider in parallel. A failing provider only adds an entry to `errors`.
// `ctx` may contain { fetch, detectLanguage, cache: { get, set } }.
export async function lookup(req, settings, ctx = {}) {
  const text = req.text.trim();
  const src = await resolveSourceLang(req, settings, ctx.detectLanguage);
  const tgt = languages.normalize(settings.targetLang) ?? "en";
  const translator = pickTranslator(settings, src, tgt);
  const needsTranslation = src !== tgt;
  const sentence = req.sentence && req.sentence !== text ? req.sentence : "";

  const base = {
    word: text,
    sentence,
    sourceLang: src,
    targetLang: tgt,
    translator: translator.name,
  };

  const cacheKey = [translator.id, src, tgt, text].join("|");
  let wordPart = await ctx.cache?.get(cacheKey);
  const tasks = [];

  if (!wordPart) {
    const enabled = (p) => settings.providers[p.id] !== false && p.supports(src, tgt);
    const providerReq = { text, src, tgt };
    tasks.push(
      needsTranslation ? translator.lookup(providerReq, settings, ctx) : Promise.resolve({ translation: "" }),
      ...dictionaries.filter(enabled).map((p) => p.lookup(providerReq, settings, ctx)),
      ...exampleSources.filter(enabled).map((p) => p.lookup(providerReq, settings, ctx)),
    );
  }
  const sentenceTask =
    sentence && needsTranslation && settings.translateSentence
      ? translator.lookup({ text: sentence, src, tgt }, settings, ctx)
      : Promise.resolve({ translation: "" });

  const [sentenceResult, ...results] = await Promise.allSettled([sentenceTask, ...tasks]);
  const errors = [sentenceResult, ...results]
    .filter((r) => r.status === "rejected")
    .map((r) => r.reason?.message ?? String(r.reason));

  if (!wordPart) {
    wordPart = merge(results.filter((r) => r.status === "fulfilled").map((r) => r.value), settings);
    // Only cache complete results, so a temporary outage does not stick for 30 days.
    if (!errors.length) await ctx.cache?.set(cacheKey, wordPart);
  }

  return {
    ...base,
    ...wordPart,
    sentenceTranslation: sentenceResult.status === "fulfilled" ? sentenceResult.value.translation : "",
    errors,
  };
}

// Combines provider results. Earlier results win for single values; lists are concatenated.
export function merge(parts, settings) {
  const merged = { translation: "", ipa: "", audioUrl: "", definitions: [], examples: [] };
  for (const part of parts) {
    merged.translation ||= part.translation ?? "";
    merged.ipa ||= part.ipa ?? "";
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
