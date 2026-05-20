import { renderToString } from 'react-dom/server';
import DOMPurify from 'dompurify';
import type { MarkedExtension } from 'marked';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Markdown, normalizeStreamingMarkdown } from '../components/Markdown';
import { resolveMarkedInstance } from '../components/markdown/marked';
import { renderMarkdown } from '../components/markdown/renderMarkdown';
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

  it('reuses an existing trailing newline instead of doubling it before the closing backtick fence', () => {
    const text = 'Before\n```ts\nconst x = 1;\n';

    expect(normalizeStreamingMarkdown(text)).toBe(`${text}\`\`\``);
  });

  it('reuses an existing trailing newline instead of doubling it before the closing tilde fence', () => {
    const text = 'Before\n~~~ts\nconst x = 1;\n';

    expect(normalizeStreamingMarkdown(text)).toBe(`${text}~~~`);
  });

  it('finalizes a trailing fence with the same paragraph spacing the stream rendered', () => {
    // A streamed assistant message that stops mid-fence: the last code line
    // ends in '\n', so `text` ends in '\n'. When the model emits its own
    // closing fence it just adds '```' on the next line, so finalizing the
    // stream must produce that exact document — not a doubled '\n\n```' that
    // adds a visible blank line and shifts the transcript on finalize.
    const streamed = 'First paragraph.\n\nSecond paragraph.\n\n```ts\nconst x = 1;\n';
    const modelClosed = `${streamed}\`\`\``;
    const marked = resolveMarkedInstance(true);

    const finalized = renderMarkdown(normalizeStreamingMarkdown(streamed), undefined, marked);
    const explicitlyClosed = renderMarkdown(modelClosed, undefined, marked);

    expect(finalized).toBe(explicitlyClosed);
    expect(finalized).toMatchInlineSnapshot(`
      "<p>First paragraph.</p>
      <p>Second paragraph.</p>
      <pre><code class="hljs language-ts">const x = 1;
      </code></pre>"
    `);
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

  it('injects copy chrome for pre/code HTML with whitespace between tags', () => {
    const { container } = render(<Markdown text={'<pre>\n<code class="hljs">x</code>\n</pre>'} />);

    expect(screen.getByRole('button', { name: 'Copy code' })).toHaveTextContent('Copy');
    expect(container.querySelector('.chorus-codeblock .chorus-copy-btn + pre > code.hljs')).toHaveTextContent('x');
  });

  it.each([
    ['Enter', 'Enter'],
    ['Space', ' '],
  ])('copies fenced code from the keyboard with %s and resets the button label', async (_label, key) => {
    vi.useFakeTimers();
    const writeText = mockClipboardWriteText();
    render(<Markdown text={'```ts\nconst x = 1;\n```'} />);
    const button = screen.getByRole('button', { name: 'Copy code' });

    button.focus();
    expect(button).toHaveFocus();
    expect(fireEvent.keyDown(button, { key, cancelable: true })).toBe(false);
    await act(async () => { await Promise.resolve(); });

    expect(writeText).toHaveBeenCalledWith('const x = 1;');
    expect(button).toHaveTextContent('Copied!');

    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });

    expect(button).toHaveTextContent('Copy');
  });

  it('shows copy failure feedback and calls onCopyError when clipboard write rejects', async () => {
    vi.useFakeTimers();
    const clipboardError = new Error('Permission denied');
    const writeText = mockClipboardWriteText(vi.fn((_text: string) => Promise.reject(clipboardError)));
    const onCopyError = vi.fn();
    render(<Markdown text={'```ts\nconst x = 1;\n```'} onCopyError={onCopyError} />);
    const button = screen.getByRole('button', { name: 'Copy code' });

    fireEvent.click(button);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith('const x = 1;');
    expect(onCopyError).toHaveBeenCalledWith(clipboardError);
    expect(button).toHaveTextContent('Copy failed');
    expect(button).toHaveClass('copy-failed');

    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });

    expect(button).toHaveTextContent('Copy');
    expect(button).not.toHaveClass('copy-failed');
  });
});
