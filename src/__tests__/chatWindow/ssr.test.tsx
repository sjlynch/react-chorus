import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { act } from '@testing-library/react';
import {
  ASST_MSG,
  ChatWindow,
} from './testUtils';

// Mock Markdown to avoid DOMPurify/highlight.js complexity in unit tests.
vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text, headless, streaming, sanitizer }: { text: string; headless?: boolean; streaming?: boolean; sanitizer?: unknown }) => (
    <span data-testid="markdown" data-headless={String(headless)} data-streaming={String(streaming)} data-sanitizer={String(Boolean(sanitizer))}>{text}</span>
  ),
}));

describe('ChatWindow server rendering behavior', () => {
  it('produces a hydration-stable initial tree when navigator.clipboard is only available client-side', () => {
    // Simulate SSR: navigator.clipboard.writeText is unavailable, so the
    // copy feature-detect must not commit copy buttons into the server tree.
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Reflect.deleteProperty(navigator, 'clipboard');
    let serverHtml: string;
    try {
      serverHtml = renderToString(<ChatWindow messages={[ASST_MSG]} />);
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    }

    expect(serverHtml).not.toMatch(/aria-label="Copy"/);

    // Hydrate on a client where navigator.clipboard IS available. The initial
    // client render must match the SSR output (so React emits no hydration
    // mismatch warning), and the copy button must appear after the mount
    // effect runs.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    document.body.appendChild(container);
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      act(() => {
        root = hydrateRoot(container, <ChatWindow messages={[ASST_MSG]} />);
      });

      const hydrationError = errorSpy.mock.calls.find(call =>
        call.some(arg => typeof arg === 'string' && /hydrat/i.test(arg))
      );
      expect(hydrationError).toBeUndefined();

      expect(container.querySelector('button[aria-label="Copy"]')).not.toBeNull();
    } finally {
      act(() => { root?.unmount(); });
      container.remove();
      errorSpy.mockRestore();
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
});
