import { Marked, type MarkedExtension, type MarkedOptions } from 'marked';
import { markedHighlight } from 'marked-highlight';
import { highlightCode } from '../../utils/hljsLoader';
import { escapeHtml, isSafeImageUrl, isSafeLinkUrl } from './sanitize';

const DEFAULT_MARKED_OPTIONS: MarkedOptions = { gfm: true, breaks: true };

function createHighlightExtension() {
  return markedHighlight({
    langPrefix: 'hljs language-',
    highlight: highlightCode,
  });
}

function createMarkedInstance(options?: MarkedOptions) {
  const instance = new Marked();
  // Always layer caller options on top of the defaults so a partial override
  // (e.g. `{ breaks: false }`) does not silently drop `gfm`, which would
  // disable tables, task lists, autolinks, etc.
  instance.setOptions({ ...DEFAULT_MARKED_OPTIONS, ...options });
  instance.use(createHighlightExtension());
  return instance;
}

const markedInstance = createMarkedInstance();
const safeMarkedInstance = createMarkedInstance();

const safeRendererExtension: MarkedExtension = {
  renderer: {
    html() {
      return '';
    },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      if (!isSafeLinkUrl(href)) return label;

      return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${label}</a>`;
    },
    image({ href, title, text, tokens }) {
      const alt = tokens ? this.parser.parseInline(tokens, this.parser.textRenderer) : text;
      if (!isSafeImageUrl(href)) return escapeHtml(alt);

      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ''}>`;
    },
  },
};

safeMarkedInstance.use(safeRendererExtension);

function hasCustomMarkedConfig(markedOptions?: MarkedOptions, markedExtensions?: MarkedExtension[]) {
  // Treat empty objects/arrays as "no override" so a parent that inlines
  // `markedOptions={{}}` or `markedExtensions={[]}` keeps reusing the shared
  // singleton instead of rebuilding (and re-`use`-ing) Marked on every render.
  const hasOptions = markedOptions !== undefined && Object.keys(markedOptions).length > 0;
  const hasExtensions = (markedExtensions?.length ?? 0) > 0;
  return hasOptions || hasExtensions;
}

function createConfiguredMarkedInstance(markedOptions: MarkedOptions | undefined, markedExtensions: MarkedExtension[] | undefined, safe: boolean) {
  const instance = createMarkedInstance(markedOptions);
  if (markedExtensions?.length) instance.use(...markedExtensions);
  if (safe) instance.use(safeRendererExtension);
  return instance;
}

export function resolveMarkedInstance(safe: boolean, markedOptions?: MarkedOptions, markedExtensions?: MarkedExtension[]) {
  if (!hasCustomMarkedConfig(markedOptions, markedExtensions)) return safe ? safeMarkedInstance : markedInstance;
  return createConfiguredMarkedInstance(markedOptions, markedExtensions, safe);
}

export type { MarkedExtension, MarkedOptions };
