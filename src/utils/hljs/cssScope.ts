import type { CodeTheme } from './theme';

const NESTING_AT_RULES = new Set(['media', 'supports', 'container', 'layer', 'scope', 'document', 'starting-style']);

export function scopeHljsThemeCss(css: string, theme: CodeTheme) {
  return scopeCssRules(stripCssComments(css), `.chorus-codeblock-${theme}`);
}

function scopeCssRules(css: string, scope: string): string {
  let output = '';
  let cursor = 0;

  while (cursor < css.length) {
    const open = findNextRuleOpen(css, cursor);
    if (open === -1) {
      output += css.slice(cursor);
      break;
    }

    const close = findMatchingBrace(css, open);
    if (close === -1) {
      output += css.slice(cursor);
      break;
    }

    const rawPrelude = css.slice(cursor, open);
    const semicolon = findLastTopLevelSemicolon(rawPrelude);
    const leading = semicolon === -1 ? '' : rawPrelude.slice(0, semicolon + 1);
    const prelude = semicolon === -1 ? rawPrelude : rawPrelude.slice(semicolon + 1);
    const block = css.slice(open + 1, close);
    const trimmedPrelude = prelude.trim();

    output += leading;
    if (trimmedPrelude.startsWith('@')) {
      output += `${prelude}{${shouldScopeAtRuleBlock(trimmedPrelude) ? scopeCssRules(block, scope) : block}}`;
    } else {
      output += `${prefixSelectorList(prelude, scope)}{${block}}`;
    }

    cursor = close + 1;
  }

  return output;
}

function shouldScopeAtRuleBlock(prelude: string) {
  const atRuleName = prelude.match(/^@([\w-]+)/)?.[1]?.toLowerCase();
  return atRuleName ? NESTING_AT_RULES.has(atRuleName) : false;
}

function prefixSelectorList(selectors: string, scope: string) {
  const leading = selectors.match(/^\s*/)?.[0] ?? '';
  const trailing = selectors.match(/\s*$/)?.[0] ?? '';
  const scoped = splitTopLevelSelectors(selectors.trim())
    .map(selector => selector.trim())
    .filter(Boolean)
    .map(selector => selector.startsWith(scope) ? selector : `${scope} ${selector}`)
    .join(', ');
  return `${leading}${scoped}${trailing}`;
}

// Shared CSS scanner. Yields one event per character with quote/escape and
// `/* ... */` comments handled once, plus running paren/bracket depth so the
// per-scanner loops below only have to look at the chars they actually care
// about. `parenDepth`/`bracketDepth` are reported BEFORE the current char
// takes effect, matching how the original hand-rolled loops checked depth
// before incrementing on `(`/`[`. Unterminated comments end the generator,
// mirroring the `break`/`i = length` exits in the originals.
interface CssCharEvent {
  index: number;
  char: string;
  inString: boolean;
  parenDepth: number;
  bracketDepth: number;
}

function* scanCssChars(css: string, start = 0): Generator<CssCharEvent> {
  let quote: '"' | "'" | null = null;
  let escaping = false;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = start; i < css.length; i++) {
    const char = css[i];
    if (char === undefined) continue;

    if (quote) {
      yield { index: i, char, inString: true, parenDepth, bracketDepth };
      if (escaping) escaping = false;
      else if (char === '\\') escaping = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      if (end === -1) return;
      i = end + 1;
      continue;
    }

    if (char === '"' || char === "'") {
      yield { index: i, char, inString: false, parenDepth, bracketDepth };
      quote = char;
      continue;
    }

    yield { index: i, char, inString: false, parenDepth, bracketDepth };

    if (char === '(') parenDepth++;
    else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (char === '[') bracketDepth++;
    else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
  }
}

function splitTopLevelSelectors(selectors: string) {
  const parts: string[] = [];
  let partStart = 0;
  for (const { index, char, inString, parenDepth, bracketDepth } of scanCssChars(selectors)) {
    if (!inString && char === ',' && parenDepth === 0 && bracketDepth === 0) {
      parts.push(selectors.slice(partStart, index));
      partStart = index + 1;
    }
  }
  parts.push(selectors.slice(partStart));
  return parts;
}

function stripCssComments(css: string) {
  let output = '';
  for (const { char } of scanCssChars(css)) output += char;
  return output;
}

function findNextRuleOpen(css: string, start: number) {
  for (const { index, char, inString, parenDepth, bracketDepth } of scanCssChars(css, start)) {
    if (!inString && char === '{' && parenDepth === 0 && bracketDepth === 0) return index;
  }
  return -1;
}

function findMatchingBrace(css: string, open: number) {
  let depth = 0;
  for (const { index, char, inString } of scanCssChars(css, open)) {
    if (inString) continue;
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findLastTopLevelSemicolon(text: string) {
  let last = -1;
  for (const { index, char, inString, parenDepth, bracketDepth } of scanCssChars(text)) {
    if (!inString && char === ';' && parenDepth === 0 && bracketDepth === 0) last = index;
  }
  return last;
}
