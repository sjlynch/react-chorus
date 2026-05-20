import { renderToString } from 'react-dom/server';
import DOMPurify from 'dompurify';
import type { MarkedExtension } from 'marked';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Markdown, normalizeStreamingMarkdown } from '../components/Markdown';
import { scopeHljsThemeCss } from '../utils/hljsLoader';

const mocks = vi.hoisted(() => {
  const sanitizeMock = vi.fn((html: string) => html);
  const hljsMock = {
    getLanguage: vi.fn(() => true),
    highlight: vi.fn((code: string) => ({ value: `<span class="hljs-keyword">${code}</span>` })),
    highlightAuto: vi.fn((code: string) => ({ value: `<span class="hljs-keyword">${code}</span>` })),
  };
  const highlightModuleLoads = { value: 0 };

  return { sanitizeMock, hljsMock, highlightModuleLoads };
});

vi.mock('dompurify', () => ({
  default: {
    sanitize: mocks.sanitizeMock,
  },
}));

vi.mock('highlight.js', () => {
  mocks.highlightModuleLoads.value += 1;
  return { default: mocks.hljsMock };
});

const originalNavigatorClipboard = typeof navigator === 'undefined' ? undefined : Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function mockClipboardWriteText(writeText = vi.fn((_text: string) => Promise.resolve())) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

beforeEach(() => {
  mocks.sanitizeMock.mockClear();
  mocks.sanitizeMock.mockImplementation((html: string) => html);
  mocks.hljsMock.getLanguage.mockClear();
  mocks.hljsMock.highlight.mockClear();
  mocks.hljsMock.highlightAuto.mockClear();
  document.getElementById('chorus-md-styles')?.remove();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (originalNavigatorClipboard) Object.defineProperty(navigator, 'clipboard', originalNavigatorClipboard);
  else delete (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
  document.getElementById('chorus-md-styles')?.remove();
});

describe('normalizeStreamingMarkdown', () => {
  it('leaves an even number of backtick fences unchanged', () => {
    const text = 'Before\n```ts\nconst x = 1;\n```\nAfter';

    expect(normalizeStreamingMarkdown(text)).toBe(text);
  });

  it('appends a closing backtick fence for an odd number of backtick fences', () => {
    const text = 'Before\n```ts\nconst x = 1;';

    expect(normalizeStreamingMarkdown(text)).toBe(`${text}\n\`\`\``);
  });

  it('appends a closing tilde fence for an odd number of tilde fences', () => {
    const text = 'Before\n~~~ts\nconst x = 1;';

    expect(normalizeStreamingMarkdown(text)).toBe(`${text}\n~~~`);
  });

  it('patches odd backtick and tilde fences independently', () => {
    const text = '```ts\nconst x = 1;\n~~~txt\nhello';

    expect(normalizeStreamingMarkdown(text)).toBe(`${text}\n\`\`\`\n~~~`);
  });

  it('ignores inline triple-backticks that are not at the start of a line', () => {
    const text = 'Use ``` for code';

    expect(normalizeStreamingMarkdown(text)).toBe(text);
  });

  it('still closes a real fence even when inline backticks appear before it', () => {
    const text = 'Use ``` on its own line, like:\n```ts\nconst x = 1;';

    expect(normalizeStreamingMarkdown(text)).toBe(`${text}\n\`\`\``);
  });
});

describe('scopeHljsThemeCss', () => {
  it('scopes modern selectors without splitting functional pseudo-class commas', () => {
    const css = `
      /* stripped */
      .hljs:is(.keyword, .title), pre code.hljs[data-token="{"] { color: red; --token-map: "{,}"; }
      @media (prefers-color-scheme: dark) {
        .hljs:has(.attr, .string) { color: blue; }
      }
      @keyframes hljs-fade { from { opacity: 0; } to { opacity: 1; } }
    `;

    const scoped = scopeHljsThemeCss(css, 'dark');

    expect(scoped).toContain('.chorus-codeblock-dark .hljs:is(.keyword, .title), .chorus-codeblock-dark pre code.hljs[data-token="{"]');
    expect(scoped).toContain('.chorus-codeblock-dark .hljs:has(.attr, .string)');
    expect(scoped).toContain('@keyframes hljs-fade { from { opacity: 0; } to { opacity: 1; } }');
    expect(scoped).not.toContain('.chorus-codeblock-dark from');
  });

  it('scopes the parent selector for native nested CSS rules', () => {
    const scoped = scopeHljsThemeCss('.hljs { color: red; & .token, &:where(.active, .focus) { font-weight: bold; } }', 'light');

    expect(scoped).toContain('.chorus-codeblock-light .hljs {');
    expect(scoped).toContain('& .token, &:where(.active, .focus) { font-weight: bold; }');
  });
});

describe('Markdown', () => {
  it('renders Markdown HTML and sanitizes it', () => {
    render(<Markdown text={'# Hello\n\nThis is **bold**.'} headless />);

    expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument();
    expect(screen.getByText('bold')).toBeInTheDocument();
    expect(mocks.sanitizeMock).toHaveBeenCalledWith(expect.stringContaining('<strong>bold</strong>'));
    expect(mocks.highlightModuleLoads.value).toBe(0);
  });

  it('respects markedOptions by allowing breaks=false to disable single-newline <br> tags', () => {
    const { container } = render(<Markdown text={'first\nsecond'} headless markedOptions={{ breaks: false }} />);

    expect(container.querySelector('br')).not.toBeInTheDocument();
    expect(container.querySelector('p')?.textContent).toBe('first\nsecond');
  });

  it('registers markedExtensions on an isolated parser instance', () => {
    const extension: MarkedExtension = {
      hooks: {
        postprocess(html) {
          return html.replace('Hello', '<span data-marked-extension="fired">Hello</span>');
        },
      },
    };

    const { container, rerender } = render(<Markdown text="Hello" headless markedExtensions={[extension]} />);

    expect(container.querySelector('[data-marked-extension="fired"]')).toHaveTextContent('Hello');

    rerender(<Markdown text="Hello" headless />);

    expect(container.querySelector('[data-marked-extension="fired"]')).not.toBeInTheDocument();
  });

  it.each([
    ['script tag', '<script>alert(1)</script>'],
    ['image event handler', '<img src=x onerror="alert(2)">'],
    ['malformed SVG/math event handler', '<svg><g/onload=alert(3)//<math><mi xlink:href="javascript:alert(4)">x</mi></math>'],
    ['JavaScript markdown URLs', '[click](javascript:alert(5))\n\n![alt](javascript:alert(6))\n\n[encoded](jav&#x61;script&colon;alert(7))'],
  ])('uses SSR safe mode when no real sanitizer is available for %s', (_name, payload) => {
    const originalWindow = globalThis.window;
    const domPurifyMock = DOMPurify as unknown as { sanitize?: (html: string) => string };
    const originalSanitize = domPurifyMock.sanitize;
    domPurifyMock.sanitize = undefined;
    Object.defineProperty(globalThis, 'window', { value: undefined, configurable: true, writable: true });

    try {
      const html = renderToString(<Markdown text={payload} />);

      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<svg/i);
      expect(html).not.toMatch(/<math/i);
      expect(html).not.toMatch(/\son[a-z0-9:-]+\s*=/i);
      expect(html).not.toMatch(/\s(?:href|src|xlink:href)\s*=\s*["']?\s*(?:javascript|vbscript|data):/i);
      expect(html).not.toMatch(/srcdoc\s*=/i);
    } finally {
      domPurifyMock.sanitize = originalSanitize;
      Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true, writable: true });
    }
  });

  it('keeps ordinary markdown stable in SSR safe mode', () => {
    const originalWindow = globalThis.window;
    const domPurifyMock = DOMPurify as unknown as { sanitize?: (html: string) => string };
    const originalSanitize = domPurifyMock.sanitize;
    domPurifyMock.sanitize = undefined;
    Object.defineProperty(globalThis, 'window', { value: undefined, configurable: true, writable: true });

    try {
      const html = renderToString(<Markdown text={'# Hello\n\nThis is **bold** with [a link](https://example.com).'} headless />);

      expect(html).toContain('<h1>Hello</h1>');
      expect(html).toContain('<strong>bold</strong>');
      expect(html).toContain('<a href="https://example.com">a link</a>');
    } finally {
      domPurifyMock.sanitize = originalSanitize;
      Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true, writable: true });
    }
  });

  it('uses a custom sanitizer during SSR when provided', () => {
    const originalWindow = globalThis.window;
    const domPurifyMock = DOMPurify as unknown as { sanitize?: (html: string) => string };
    const originalSanitize = domPurifyMock.sanitize;
    const customSanitizer = vi.fn((html: string) => html.replace('<custom>', '<em>').replace('</custom>', '</em>'));
    domPurifyMock.sanitize = undefined;
    Object.defineProperty(globalThis, 'window', { value: undefined, configurable: true, writable: true });

    try {
      const html = renderToString(<Markdown text={'<custom>trusted</custom>'} headless sanitizer={customSanitizer} />);

      expect(customSanitizer).toHaveBeenCalledWith(expect.stringContaining('<custom>trusted</custom>'));
      expect(html).toContain('<em>trusted</em>');
    } finally {
      domPurifyMock.sanitize = originalSanitize;
      Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true, writable: true });
    }
  });

  it('renders escaped plain text while streaming and parses markdown once finalized', () => {
    const first = 'Hello <img src=x onerror="boom"> **bold**';
    const { container, rerender } = render(<Markdown text={first} streaming />);

    expect(container.querySelector('.chorus-md-streaming')).toBeInTheDocument();
    expect(container.innerHTML).toContain('&lt;img src=x onerror="boom"&gt;');
    expect(container.innerHTML).not.toContain('<img src=x');
    expect(container).toHaveTextContent('**bold**');
    expect(mocks.sanitizeMock).not.toHaveBeenCalled();

    rerender(<Markdown text={`${first}\n${'more text '.repeat(2000)}`} streaming />);

    expect(mocks.sanitizeMock).not.toHaveBeenCalled();

    rerender(<Markdown text={'Hello **bold**'} headless />);

    expect(mocks.sanitizeMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('bold')).toBeInTheDocument();
  });

  it('does not inject component styles when headless=true', () => {
    render(<Markdown text="Hello" headless />);

    expect(document.getElementById('chorus-md-styles')).not.toBeInTheDocument();
  });

  it('injects component styles once when headless=false', () => {
    const { rerender } = render(<Markdown text="Hello" />);

    expect(document.getElementById('chorus-md-styles')).toBeInTheDocument();

    rerender(<Markdown text="Hello again" />);

    expect(document.querySelectorAll('#chorus-md-styles')).toHaveLength(1);
  });

  it('lazy-loads highlight.js when fenced code appears', async () => {
    expect(mocks.highlightModuleLoads.value).toBe(0);

    const { rerender } = render(<Markdown text="No code here" />);

    expect(mocks.highlightModuleLoads.value).toBe(0);

    rerender(<Markdown text={'```ts\nconst x = 1;\n```'} />);

    await waitFor(() => expect(mocks.highlightModuleLoads.value).toBe(1));
    await waitFor(() => expect(mocks.hljsMock.highlight).toHaveBeenCalledWith('const x = 1;', { language: 'ts' }));
  });

  it("adds the light code theme class to code wrappers when codeTheme='light'", async () => {
    const { container } = render(<Markdown text={'```ts\nconst x = 1;\n```'} codeTheme="light" />);

    expect(container.querySelector('.chorus-codeblock-light')).toBeInTheDocument();
    expect(container.querySelector('.chorus-codeblock-dark')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.hljsMock.getLanguage).toHaveBeenCalledWith('ts'));
  });

  it("adds the dark code theme class to code wrappers when codeTheme='dark'", async () => {
    const { container } = render(<Markdown text={'```ts\nconst x = 1;\n```'} codeTheme="dark" />);

    expect(container.querySelector('.chorus-codeblock-dark')).toBeInTheDocument();
    expect(container.querySelector('.chorus-codeblock-light')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.hljsMock.getLanguage).toHaveBeenCalledWith('ts'));
  });

  it('injects copy chrome as a real, focusable <button> with a polite live region', () => {
    const { container } = render(<Markdown text={'<pre>\n<code class="hljs">x</code>\n</pre>'} />);

    const button = screen.getByRole('button', { name: 'Copy code' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveTextContent('Copy');
    button.focus();
    expect(button).toHaveFocus();

    const status = container.querySelector('.chorus-copy-status');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(container.querySelector('.chorus-codeblock .chorus-copy-status + pre > code.hljs')).toHaveTextContent('x');
  });

  it('copies fenced code on activation, announces the state, and resets it', async () => {
    vi.useFakeTimers();
    const writeText = mockClipboardWriteText();
    const { container } = render(<Markdown text={'```ts\nconst x = 1;\n```'} />);
    const button = screen.getByRole('button', { name: 'Copy code' });
    const status = container.querySelector('.chorus-copy-status') as HTMLElement;

    expect(status).toHaveTextContent('');

    // A real <button> activates on click for both pointer and keyboard input.
    fireEvent.click(button);
    await act(async () => { await Promise.resolve(); });

    expect(writeText).toHaveBeenCalledWith('const x = 1;');
    expect(button).toHaveTextContent('Copied!');
    expect(button).toHaveAttribute('aria-label', 'Copied!');
    expect(status).toHaveTextContent('Copied!');

    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });

    expect(button).toHaveTextContent('Copy');
    expect(button).toHaveAttribute('aria-label', 'Copy code');
    expect(status).toHaveTextContent('');
  });

  it('shows copy failure feedback in the aria-label and live region and calls onCopyError', async () => {
    vi.useFakeTimers();
    const clipboardError = new Error('Permission denied');
    const writeText = mockClipboardWriteText(vi.fn((_text: string) => Promise.reject(clipboardError)));
    const onCopyError = vi.fn();
    const { container } = render(<Markdown text={'```ts\nconst x = 1;\n```'} onCopyError={onCopyError} />);
    const button = screen.getByRole('button', { name: 'Copy code' });
    const status = container.querySelector('.chorus-copy-status') as HTMLElement;

    fireEvent.click(button);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith('const x = 1;');
    expect(onCopyError).toHaveBeenCalledWith(clipboardError);
    expect(button).toHaveTextContent('Copy failed');
    expect(button).toHaveAttribute('aria-label', 'Copy failed');
    expect(button).toHaveClass('copy-failed');
    expect(status).toHaveTextContent('Copy failed');

    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });

    expect(button).toHaveTextContent('Copy');
    expect(button).toHaveAttribute('aria-label', 'Copy code');
    expect(button).not.toHaveClass('copy-failed');
    expect(status).toHaveTextContent('');
  });

  it('omits the copy chrome but keeps the styled wrapper when codeBlockCopy is false', () => {
    const { container } = render(<Markdown text={'```ts\nconst x = 1;\n```'} codeBlockCopy={false} />);

    expect(container.querySelector('.chorus-codeblock')).toBeInTheDocument();
    expect(container.querySelector('.chorus-copy-btn')).not.toBeInTheDocument();
    expect(container.querySelector('.chorus-copy-status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders custom copy chrome from a codeBlockCopy function and keeps the clipboard wiring', async () => {
    const writeText = mockClipboardWriteText();
    const renderCopy = ({ theme, labels }: { theme: string; labels: { copy: string } }) =>
      `<span class="chorus-copy-btn" role="button" tabindex="0" data-theme="${theme}">${labels.copy} it</span>`;
    render(<Markdown text={'```ts\nconst x = 1;\n```'} codeBlockCopy={renderCopy} />);

    const button = screen.getByRole('button', { name: 'Copy it' });
    expect(button.tagName).toBe('SPAN');
    expect(button).toHaveAttribute('data-theme', 'dark');

    // Non-button custom chrome still gets keyboard activation polyfilled.
    button.focus();
    expect(fireEvent.keyDown(button, { key: 'Enter', cancelable: true })).toBe(false);
    await act(async () => { await Promise.resolve(); });

    expect(writeText).toHaveBeenCalledWith('const x = 1;');
  });
});
