// Small fetch helpers shared by all providers.

export const DEFAULT_TIMEOUT_MS = 8000;

export class ProviderError extends Error {
  constructor(provider, message) {
    super(`${provider}: ${message}`);
    this.provider = provider;
  }
}

// Fetches JSON with a timeout. `ctx.fetch` lets tests inject a fake fetch.
// Returns null for 404 so "word not found" is not treated as an error.
export async function fetchJson(provider, url, options = {}, ctx = {}) {
  const fetchImpl = ctx.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new ProviderError(provider, `HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") throw new ProviderError(provider, "request timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

// Converts provider HTML snippets to plain text. Results are only ever rendered via
// textContent, so this is about readability, not sanitizing.
export function stripHtml(html) {
  return String(html ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
      if (entity[0] === "#") {
        const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return ENTITIES[entity.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, " ")
    .trim();
}
