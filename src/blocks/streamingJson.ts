/**
 * Tolerant streaming-JSON parser used to derive a best-effort intermediate
 * object from a still-streaming JSON argument string. The model emits block
 * props as a JSON string that arrives in deltas; rather than wait for the
 * closing brace, this helper:
 *
 * 1. Walks the input tracking string state and the open-bracket/brace stack.
 * 2. Trims a trailing comma, colon, or partial key so the suffix is a valid
 *    structural close point.
 * 3. Appends the matching close characters (`]`, `}`, or `"`) to reach a
 *    syntactically complete JSON value.
 * 4. Runs `JSON.parse` on the closed string and returns the parsed value.
 *
 * If the closed result still won't parse (deeply malformed input), returns
 * `{ ok: false }` so the caller can fall back to the prior partial value.
 */

export interface StreamingJsonResult {
  ok: boolean;
  /** Parsed value when `ok`. May be `undefined` for an empty input. */
  value?: unknown;
  /** Closed input passed to `JSON.parse` (exposed for diagnostics/tests). */
  closed?: string;
}

const WHITESPACE = /\s/;

function scan(input: string): { stack: string[]; inString: boolean } {
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charAt(i);
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') { stack.push(ch === '{' ? '}' : ']'); continue; }
    if (ch === '}' || ch === ']') { stack.pop(); continue; }
  }
  return { stack, inString };
}

function findUnclosedQuotePosition(input: string): number {
  let inString = false;
  let escape = false;
  let openAt = -1;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charAt(i);
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = false; openAt = -1; }
      continue;
    }
    if (ch === '"') { inString = true; openAt = i; }
  }
  return inString ? openAt : -1;
}

export function parseStreamingJson(input: string): StreamingJsonResult {
  if (input === '') return { ok: true, value: undefined, closed: '' };

  const trimmedStart = input.replace(/^\s+/, '');
  if (trimmedStart === '') return { ok: true, value: undefined, closed: '' };

  // Quick path: already-complete JSON.
  try {
    return { ok: true, value: JSON.parse(trimmedStart), closed: trimmedStart };
  } catch {}

  let working = trimmedStart;

  // Drop an unclosed string at the tail (e.g. `{ "city": "San Fr`).
  const openQuote = findUnclosedQuotePosition(working);
  if (openQuote >= 0) {
    working = working.slice(0, openQuote);
  }

  // Trim trailing whitespace, commas, and `:` / dangling key blobs that
  // would leave the suffix in an incomplete structural state.
  for (let safety = 0; safety < 64; safety++) {
    working = working.replace(/\s+$/, '');
    if (!working) break;
    const tail = working.charAt(working.length - 1);
    if (tail === ',') { working = working.slice(0, -1); continue; }
    if (tail === ':') {
      // Drop the colon and its preceding key string. Find the closing quote
      // of the key, then walk back to its opening quote.
      let j = working.length - 2;
      while (j >= 0 && WHITESPACE.test(working.charAt(j))) j--;
      if (j >= 0 && working.charAt(j) === '"') {
        let k = j - 1;
        while (k >= 0) {
          if (working.charAt(k) === '"') {
            let bs = 0;
            let m = k - 1;
            while (m >= 0 && working.charAt(m) === '\\') { bs++; m--; }
            if (bs % 2 === 0) break;
          }
          k--;
        }
        working = k >= 0 ? working.slice(0, k) : working.slice(0, -1);
        working = working.replace(/[,\s]+$/, '');
        continue;
      }
      working = working.slice(0, -1);
      continue;
    }
    // Strip a trailing partial number/identifier inside a value position so
    // we don't leave `{"x": 1.` or `{"x": tru` in the input.
    if (/[A-Za-z0-9_\-.+]/.test(tail)) {
      // Find the start of the partial token.
      let j = working.length - 1;
      while (j >= 0 && /[A-Za-z0-9_\-.+]/.test(working.charAt(j))) j--;
      // If the previous non-whitespace char is `:`, this is a value position.
      let p = j;
      while (p >= 0 && WHITESPACE.test(working.charAt(p))) p--;
      if (p >= 0 && working.charAt(p) === ':') {
        // Try parsing the partial token as a JSON value first; if it parses
        // (e.g. complete number, true/false/null), keep it.
        const tokStart = j + 1;
        const tok = working.slice(tokStart);
        try {
          JSON.parse(tok);
          break;
        } catch {
          // Partial — drop it and the `:` and key.
          working = working.slice(0, tokStart);
          working = working.replace(/\s+$/, '');
          // Now strip the trailing `:` + key on next loop iteration.
          continue;
        }
      }
      break;
    }
    break;
  }

  const { stack } = scan(working);
  let closed = working;
  for (let i = stack.length - 1; i >= 0; i--) {
    closed += stack[i];
  }
  if (closed === '') return { ok: true, value: undefined, closed };

  try {
    return { ok: true, value: JSON.parse(closed), closed };
  } catch {
    return { ok: false, closed };
  }
}
