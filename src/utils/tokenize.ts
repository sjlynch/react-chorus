/**
 * Pre-`done` (live) token estimator used while a turn is still streaming.
 *
 * Connectors only emit precise `usage` after the provider closes the stream
 * (the OpenAI Responses `response.completed` event, the Anthropic
 * `message_delta` final, the Gemini terminal `usageMetadata` candidate, the
 * AI SDK `finish`/`finish-message` frame). Until then the cost meter has no
 * authoritative count, so this module returns a best-effort estimate that
 * lets a host show a live chip rather than wait for the terminal frame.
 *
 * ## Strategy
 *
 * 1. **Lazy `js-tiktoken`**: if the consumer has the optional `js-tiktoken`
 *    peer dep installed, dynamically `import()` it and use a model-appropriate
 *    encoder. The dynamic import is gated behind a first-call cache so it is
 *    only ever fetched when a live estimate is actually requested — importing
 *    `react-chorus` never pulls the tokenizer into the main bundle.
 * 2. **Char-count heuristic** (`chars / 3.8`): when `js-tiktoken` is absent
 *    or load fails, fall back to a character-count approximation. Most
 *    English-ish text averages ~3.8 characters per BPE token; the result is
 *    intentionally rough and `estimateTokens` returns the source so the chip
 *    can display a "~412 tok (approx.)" tooltip.
 */

export type TokenEstimateSource = 'tiktoken' | 'heuristic';

export interface TokenEstimate {
  tokens: number;
  source: TokenEstimateSource;
}

const CHARS_PER_TOKEN_HEURISTIC = 3.8;

type TiktokenEncoder = { encode: (text: string) => number[] | Uint32Array };

interface TiktokenModule {
  encodingForModel?: (model: string) => TiktokenEncoder;
  getEncoding?: (encoding: string) => TiktokenEncoder;
}

let tiktokenModulePromise: Promise<TiktokenModule | null> | null = null;
const encoderCache = new Map<string, TiktokenEncoder | null>();

async function loadTiktokenModule(): Promise<TiktokenModule | null> {
  if (tiktokenModulePromise) return tiktokenModulePromise;
  tiktokenModulePromise = (async () => {
    try {
      // Stringified specifier + `as` cast keeps TS / Vite from trying to
      // statically resolve `js-tiktoken` when the consumer hasn't installed
      // it. Bundlers leave the dynamic import unresolved at build time;
      // it only fires when a host actually calls `estimateTokens` and the
      // package is on the runtime module graph.
      const specifier = 'js-tiktoken';
      const mod = (await import(/* @vite-ignore */ specifier)) as TiktokenModule;
      return mod ?? null;
    } catch {
      return null;
    }
  })();
  return tiktokenModulePromise;
}

function pickEncodingName(modelId: string | undefined): string {
  if (!modelId) return 'cl100k_base';
  // o200k_base is the GPT-4o / o-series encoding; cl100k_base is the GPT-4 /
  // GPT-3.5-turbo encoding. Other providers (Anthropic, Gemini) don't ship a
  // tokenizer matching their server-side count — cl100k_base is a reasonable
  // stand-in for the heuristic, and the chip surfaces the `source: 'heuristic'`
  // flag on the tooltip when the count is approximate.
  if (/^(gpt-4o|gpt-4\.1|o\d)/.test(modelId)) return 'o200k_base';
  return 'cl100k_base';
}

async function resolveEncoder(modelId: string | undefined): Promise<TiktokenEncoder | null> {
  const encoding = pickEncodingName(modelId);
  if (encoderCache.has(encoding)) return encoderCache.get(encoding) ?? null;
  const mod = await loadTiktokenModule();
  if (!mod) {
    encoderCache.set(encoding, null);
    return null;
  }
  try {
    const enc = mod.getEncoding?.(encoding) ?? mod.encodingForModel?.(modelId ?? 'gpt-4o');
    encoderCache.set(encoding, enc ?? null);
    return enc ?? null;
  } catch {
    encoderCache.set(encoding, null);
    return null;
  }
}

/**
 * Best-effort live token estimate. Resolves with `{ tokens, source }` where
 * `source` is either `'tiktoken'` (precise BPE count) or `'heuristic'` (the
 * char/3.8 fallback). Never throws — a bad encoder load just degrades to the
 * heuristic.
 */
export async function estimateTokens(text: string, modelId?: string): Promise<TokenEstimate> {
  if (!text) return { tokens: 0, source: 'heuristic' };
  const encoder = await resolveEncoder(modelId);
  if (encoder) {
    try {
      const encoded = encoder.encode(text);
      const len = 'length' in encoded ? encoded.length : 0;
      return { tokens: len, source: 'tiktoken' };
    } catch {
      // Encoder produced an error on this input — fall through to heuristic.
    }
  }
  return { tokens: heuristicTokenCount(text), source: 'heuristic' };
}

/** Synchronous fallback estimate (chars / 3.8, rounded). Exported for tests and host code that needs an immediate number. */
export function heuristicTokenCount(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / CHARS_PER_TOKEN_HEURISTIC));
}

/** Test helper: clear cached module + encoder so the lazy loader runs again. Not exported from the public barrel. */
export function _resetTokenizerCacheForTests() {
  tiktokenModulePromise = null;
  encoderCache.clear();
}
