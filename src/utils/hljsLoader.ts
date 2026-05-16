type HLJSApi = typeof import('highlight.js').default;
export type CodeTheme = 'dark' | 'light';

type LazyImport<T> = () => Promise<T>;

export function createRetryableLazyImport<T>(load: LazyImport<T>): LazyImport<T> {
  let promise: Promise<T> | null = null;

  return () => {
    if (!promise) {
      try {
        promise = load().catch(error => {
          promise = null;
          throw error;
        });
      } catch (error) {
        promise = null;
        return Promise.reject(error);
      }
    }
    return promise;
  };
}

// Module-level singletons — loaded once, shared across all Markdown instances.
let hljsInstance: HLJSApi | null = null;
const loadHljs = createRetryableLazyImport(() => import('highlight.js')
  .then(m => {
    hljsInstance = m.default;
    return hljsInstance;
  }));
const hljsThemeLoaders: Partial<Record<CodeTheme, LazyImport<void>>> = {};

export function isHljsLoaded() {
  return hljsInstance !== null;
}

export function getHljs(): Promise<HLJSApi> {
  if (hljsInstance) return Promise.resolve(hljsInstance);
  return loadHljs();
}

export function highlightCode(code: string, lang?: string) {
  if (!hljsInstance) return code;
  try {
    if (lang && hljsInstance.getLanguage(lang)) return hljsInstance.highlight(code, { language: lang }).value;
    return hljsInstance.highlightAuto(code).value;
  } catch {
    return code;
  }
}

export function loadHljsTheme(theme: CodeTheme): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  const styleId = `chorus-hljs-theme-${theme}`;
  if (document.getElementById(styleId)) return Promise.resolve();
  let loadTheme = hljsThemeLoaders[theme];
  if (!loadTheme) {
    loadTheme = createRetryableLazyImport(() => (theme === 'light'
      ? import('highlight.js/styles/github.css?raw')
      : import('highlight.js/styles/github-dark.css?raw'))
      .then((m: { default: string }) => {
        if (document.getElementById(styleId)) return;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = scopeHljsThemeCss(m.default, theme);
        document.head.appendChild(style);
      }));
    hljsThemeLoaders[theme] = loadTheme;
  }
  return loadTheme();
}

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
  const atRuleName = prelude.match(/^@([\w-]+)/)?.[1].toLowerCase();
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

function splitTopLevelSelectors(selectors: string) {
  const parts: string[] = [];
  let partStart = 0;
  let quote: '"' | "'" | null = null;
  let escaping = false;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < selectors.length; i++) {
    const char = selectors[i];
    const next = selectors[i + 1];

    if (quote) {
      if (escaping) escaping = false;
      else if (char === '\\') escaping = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '/' && next === '*') {
      const end = selectors.indexOf('*/', i + 2);
      i = end === -1 ? selectors.length : end + 1;
      continue;
    }

    if (char === '"' || char === "'") quote = char;
    else if (char === '(') parenDepth++;
    else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (char === '[') bracketDepth++;
    else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === ',' && parenDepth === 0 && bracketDepth === 0) {
      parts.push(selectors.slice(partStart, i));
      partStart = i + 1;
    }
  }

  parts.push(selectors.slice(partStart));
  return parts;
}

function stripCssComments(css: string) {
  let output = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (let i = 0; i < css.length; i++) {
    const char = css[i];
    const next = css[i + 1];

    if (quote) {
      output += char;
      if (escaping) escaping = false;
      else if (char === '\\') escaping = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      output += char;
    } else if (char === '/' && next === '*') {
      const end = css.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 1;
    } else {
      output += char;
    }
  }

  return output;
}

function findNextRuleOpen(css: string, start: number) {
  let quote: '"' | "'" | null = null;
  let escaping = false;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = start; i < css.length; i++) {
    const char = css[i];

    if (quote) {
      if (escaping) escaping = false;
      else if (char === '\\') escaping = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") quote = char;
    else if (char === '(') parenDepth++;
    else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (char === '[') bracketDepth++;
    else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === '{' && parenDepth === 0 && bracketDepth === 0) return i;
  }

  return -1;
}

function findMatchingBrace(css: string, open: number) {
  let quote: '"' | "'" | null = null;
  let escaping = false;
  let depth = 0;

  for (let i = open; i < css.length; i++) {
    const char = css[i];

    if (quote) {
      if (escaping) escaping = false;
      else if (char === '\\') escaping = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") quote = char;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function findLastTopLevelSemicolon(text: string) {
  let last = -1;
  let quote: '"' | "'" | null = null;
  let escaping = false;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quote) {
      if (escaping) escaping = false;
      else if (char === '\\') escaping = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") quote = char;
    else if (char === '(') parenDepth++;
    else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (char === '[') bracketDepth++;
    else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === ';' && parenDepth === 0 && bracketDepth === 0) last = i;
  }

  return last;
}
