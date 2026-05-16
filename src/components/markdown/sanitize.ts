import DOMPurify from 'dompurify';

export type MarkdownSanitizer = ((html: string) => string) | { sanitize: (html: string) => string };
export type SanitizerFn = (html: string) => string;

type DOMPurifyInstance = { sanitize?: SanitizerFn };
type DOMPurifyFactory = ((window: Window) => DOMPurifyInstance) & DOMPurifyInstance;

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

  if (codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return '\ufffd';
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

export function resolveSanitizer(sanitizer?: MarkdownSanitizer): SanitizerFn | undefined {
  if (typeof sanitizer === 'function') return sanitizer;
  if (sanitizer && typeof sanitizer.sanitize === 'function') return sanitizer.sanitize.bind(sanitizer);

  const domPurify = DOMPurify as unknown as DOMPurifyFactory;
  if (typeof domPurify.sanitize === 'function') return domPurify.sanitize.bind(domPurify);
  if (typeof window !== 'undefined' && typeof domPurify === 'function') {
    if (!browserDOMPurifySanitizer) {
      const instance = domPurify(window);
      if (typeof instance.sanitize === 'function') browserDOMPurifySanitizer = instance.sanitize.bind(instance);
    }
    return browserDOMPurifySanitizer;
  }

  return undefined;
}
