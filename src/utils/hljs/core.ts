import { createRetryableLazyImport } from './lazyImport';

type HLJSApi = typeof import('highlight.js').default;

// Module-level singleton — loaded once, shared across all Markdown instances.
let hljsInstance: HLJSApi | null = null;

const loadHljs = createRetryableLazyImport(() => import('highlight.js')
  .then(m => {
    hljsInstance = m.default;
    return hljsInstance;
  }));

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
