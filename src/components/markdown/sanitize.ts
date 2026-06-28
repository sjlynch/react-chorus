import DOMPurify from 'dompurify';

export type MarkdownSanitizer = ((html: string) => string) | { sanitize: (html: string) => string };
export type SanitizerFn = (html: string) => string;

type DOMPurifyHook = (currentNode: Element) => void;
type DOMPurifyInstance = {
  sanitize?: SanitizerFn;
  addHook?: (entryPoint: 'afterSanitizeAttributes', hook: DOMPurifyHook) => void;
};
type DOMPurifyFactory = ((window: Window) => DOMPurifyInstance) & DOMPurifyInstance;

const MAX_VALID_CODEPOINT = 0x10ffff;
const SURROGATE_RANGE_START = 0xd800;
const SURROGATE_RANGE_END = 0xdfff;
const REPLACEMENT_CHAR = '\ufffd';

const SAFE_LINK_PROTOCOLS = new Set(['http', 'https', 'mailto', 'tel']);
const SAFE_IMAGE_PROTOCOLS = new Set(['http', 'https']);
const URL_CHARACTER_REFERENCES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['colon', ':'],
  ['Tab', '\t'],
  ['tab', '\t'],
  ['NewLine', '\n'],
  ['newline', '\n'],
]);

let browserDOMPurifySanitizer: SanitizerFn | undefined;

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isSafeLinkUrl(value: string) {
  return isSafeMarkdownUrl(value, SAFE_LINK_PROTOCOLS);
}

export function isSafeImageUrl(value: string) {
  return isSafeMarkdownUrl(value, SAFE_IMAGE_PROTOCOLS);
}

function isSafeMarkdownUrl(value: string, allowedProtocols: Set<string>) {
  const normalized = removeAsciiControlAndSpace(decodeUrlCharacterReferences(value).trim());
  const colon = normalized.indexOf(':');
  if (colon === -1) return true;

  const firstDelimiter = firstUrlDelimiterIndex(normalized);
  if (firstDelimiter !== -1 && firstDelimiter < colon) return true;

  return allowedProtocols.has(normalized.slice(0, colon).toLowerCase());
}

function decodeUrlCharacterReferences(value: string) {
  let output = '';

  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '&') {
      output += value[i];
      continue;
    }

    const semicolon = value.indexOf(';', i + 1);
    if (semicolon === -1 || semicolon - i > 32) {
      output += value[i];
      continue;
    }

    const decoded = decodeCharacterReference(value.slice(i + 1, semicolon));
    if (decoded === undefined) {
      output += value.slice(i, semicolon + 1);
    } else {
      output += decoded;
    }
    i = semicolon;
  }

  return output;
}

function decodeCharacterReference(reference: string) {
  if (reference.startsWith('#x') || reference.startsWith('#X')) return decodeNumericCharacterReference(reference.slice(2), 16);
  if (reference.startsWith('#')) return decodeNumericCharacterReference(reference.slice(1), 10);
  return URL_CHARACTER_REFERENCES.get(reference);
}

function decodeNumericCharacterReference(value: string, radix: 10 | 16) {
  let codePoint = 0;
  if (!value) return undefined;

  for (const char of value) {
    const digit = digitValue(char);
    if (digit === undefined || digit >= radix) return undefined;
    codePoint = codePoint * radix + digit;
  }

  if (codePoint <= 0 || codePoint > MAX_VALID_CODEPOINT || (codePoint >= SURROGATE_RANGE_START && codePoint <= SURROGATE_RANGE_END)) return REPLACEMENT_CHAR;
  return String.fromCodePoint(codePoint);
}

function digitValue(char: string) {
  const code = char.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return undefined;
}

function removeAsciiControlAndSpace(value: string) {
  let output = '';

  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) continue;
    output += char;
  }

  return output;
}

function firstUrlDelimiterIndex(value: string) {
  const slash = value.indexOf('/');
  const query = value.indexOf('?');
  const hash = value.indexOf('#');
  let first = -1;

  for (const index of [slash, query, hash]) {
    if (index !== -1 && (first === -1 || index < first)) first = index;
  }

  return first;
}

// Targets that open a NEW top-level browsing context — so `window.opener` is set and
// the opened page can navigate the opener (reverse tabnabbing, CWE-1022). The keywords
// below reuse the current context, carry no opener, and need no hardening.
const SAME_CONTEXT_TARGETS = new Set(['', '_self', '_parent', '_top']);

// Reverse-tabnabbing hardening (CWE-1022). DOMPurify's default config STRIPS `target`,
// so model markdown rendered through the built-in sanitizer cannot open a new browsing
// context today. But if a resolved DOMPurify is ever configured to keep `target` (a
// consumer's `ADD_ATTR`, or a future "open links in a new tab" feature), a surviving
// `<a target="_blank">` would hand the opened page a usable `window.opener` — and
// DOMPurify never injects `rel` itself. This `afterSanitizeAttributes` hook is the
// safety net: it forces `rel="noopener noreferrer"` on any anchor that opens a new
// browsing context, merging (not clobbering) existing `rel` tokens and dropping a
// conflicting `opener` token that would re-enable the opener.
function hardenNewContextLinkRel(node: Element) {
  if (node.nodeName !== 'A' || typeof node.getAttribute !== 'function') return;
  const target = node.getAttribute('target');
  if (target === null || SAME_CONTEXT_TARGETS.has(target.trim().toLowerCase())) return;

  const tokens = (node.getAttribute('rel') ?? '')
    .split(/\s+/)
    .filter((token) => token && token.toLowerCase() !== 'opener');
  for (const required of ['noopener', 'noreferrer']) {
    if (!tokens.some((token) => token.toLowerCase() === required)) tokens.push(required);
  }
  node.setAttribute('rel', tokens.join(' '));
}

// Register the link-hardening hook at most once per DOMPurify instance we resolve a
// sanitizer from. (The mock-DOMPurify path used by some tests has no `addHook`; skip it.)
const linkHardenedInstances = new WeakSet<object>();
function ensureLinkHardeningHook(instance: DOMPurifyInstance) {
  if (typeof instance.addHook !== 'function' || linkHardenedInstances.has(instance)) return;
  linkHardenedInstances.add(instance);
  instance.addHook('afterSanitizeAttributes', hardenNewContextLinkRel);
}

export function resolveSanitizer(sanitizer?: MarkdownSanitizer): SanitizerFn | undefined {
  if (typeof sanitizer === 'function') return sanitizer;
  if (sanitizer && typeof sanitizer.sanitize === 'function') return sanitizer.sanitize.bind(sanitizer);

  const domPurify = DOMPurify as unknown as DOMPurifyFactory;
  if (typeof domPurify.sanitize === 'function') {
    ensureLinkHardeningHook(domPurify);
    return domPurify.sanitize.bind(domPurify);
  }
  if (typeof window !== 'undefined' && typeof domPurify === 'function') {
    if (!browserDOMPurifySanitizer) {
      const instance = domPurify(window);
      if (typeof instance.sanitize === 'function') {
        ensureLinkHardeningHook(instance);
        browserDOMPurifySanitizer = instance.sanitize.bind(instance);
      }
    }
    return browserDOMPurifySanitizer;
  }

  return undefined;
}
