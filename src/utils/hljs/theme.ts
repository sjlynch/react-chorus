import { createRetryableLazyImport, type LazyImport } from './lazyImport';
import { scopeHljsThemeCss } from './cssScope';

export type CodeTheme = 'dark' | 'light';

export const HLJS_THEME_STYLE_ID_PREFIX = 'chorus-hljs-theme-';

const hljsThemeLoaders: Partial<Record<CodeTheme, LazyImport<void>>> = {};

function getHljsThemeStyleId(theme: CodeTheme) {
  return `${HLJS_THEME_STYLE_ID_PREFIX}${theme}`;
}

export function loadHljsTheme(theme: CodeTheme): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  const styleId = getHljsThemeStyleId(theme);
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
