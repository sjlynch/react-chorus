import type { MarkedExtension, MarkedOptions } from 'marked';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Markdown } from '../components/Markdown';

const mocks = vi.hoisted(() => ({
  markedHighlight: vi.fn(() => ({})),
  sanitize: vi.fn((html: string) => html),
}));

vi.mock('marked-highlight', () => ({
  markedHighlight: mocks.markedHighlight,
}));

vi.mock('dompurify', () => ({
  default: {
    sanitize: mocks.sanitize,
  },
}));

afterEach(() => {
  cleanup();
  mocks.sanitize.mockClear();
});

describe('Markdown marked parser memoization', () => {
  it('reuses the configured Marked instance while text changes with stable options and extensions', () => {
    const baselineRegistrations = mocks.markedHighlight.mock.calls.length;
    const markedOptions: MarkedOptions = { breaks: false };
    const extension: MarkedExtension = {
      hooks: {
        postprocess(html) {
          return html;
        },
      },
    };
    const markedExtensions = [extension];

    const { rerender } = render(
      <Markdown text="first" headless markedOptions={markedOptions} markedExtensions={markedExtensions} />,
    );

    expect(mocks.markedHighlight).toHaveBeenCalledTimes(baselineRegistrations + 1);

    rerender(<Markdown text="second" headless markedOptions={markedOptions} markedExtensions={markedExtensions} />);

    expect(mocks.markedHighlight).toHaveBeenCalledTimes(baselineRegistrations + 1);
  });

  it('reuses the shared singleton (no Marked re-allocation) when markedOptions is an empty object', () => {
    const baselineRegistrations = mocks.markedHighlight.mock.calls.length;

    // Inline `{}` creates a fresh object reference on every render, defeating
    // the facade `useMemo`; the fix must still fall back to the singleton.
    const { rerender } = render(<Markdown text="first" headless markedOptions={{}} />);

    expect(mocks.markedHighlight).toHaveBeenCalledTimes(baselineRegistrations);

    rerender(<Markdown text="second" headless markedOptions={{}} />);

    expect(mocks.markedHighlight).toHaveBeenCalledTimes(baselineRegistrations);
  });

  it('reuses the shared singleton (no Marked re-allocation) when markedExtensions is an empty array', () => {
    const baselineRegistrations = mocks.markedHighlight.mock.calls.length;

    const { rerender } = render(<Markdown text="first" headless markedExtensions={[]} />);

    expect(mocks.markedHighlight).toHaveBeenCalledTimes(baselineRegistrations);

    rerender(<Markdown text="second" headless markedExtensions={[]} />);

    expect(mocks.markedHighlight).toHaveBeenCalledTimes(baselineRegistrations);
  });

  it('keeps GFM features (tables) enabled when markedOptions only overrides breaks', () => {
    const { container } = render(
      <Markdown text={'| A | B |\n| - | - |\n| 1 | 2 |'} headless markedOptions={{ breaks: false }} />,
    );

    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelectorAll('th')).toHaveLength(2);
    expect(container.querySelector('td')?.textContent).toBe('1');
  });
});
