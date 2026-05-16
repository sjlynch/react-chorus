import React from 'react';
import { getHljs, isHljsLoaded, loadHljsTheme, type CodeTheme } from '../../utils/hljsLoader';

interface HighlightLoaderOptions {
  text: string;
  codeTheme: CodeTheme;
  headless: boolean;
  streaming: boolean;
}

function hasCodeFence(text: string) {
  return text.includes('```') || text.includes('~~~');
}

export function useHighlightLoader({ text, codeTheme, headless, streaming }: HighlightLoaderOptions) {
  const [hljsReady, setHljsReady] = React.useState(isHljsLoaded());

  React.useEffect(() => {
    if (streaming) return;
    if (!hasCodeFence(text)) return;

    let cancelled = false;

    if (!headless) {
      void loadHljsTheme(codeTheme).catch(() => undefined);
    }

    if (!hljsReady) {
      void getHljs()
        .then(() => {
          if (!cancelled) setHljsReady(true);
        })
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
    };
  }, [text, codeTheme, headless, hljsReady, streaming]);

  return hljsReady;
}

export type { CodeTheme };
