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
});
