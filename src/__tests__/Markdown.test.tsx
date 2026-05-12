import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
});
