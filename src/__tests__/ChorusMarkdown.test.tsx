import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Chorus } from '../Chorus';
import type { Message } from '../types';

function firstMarkdownInnerHTML(serverHtml: string) {
  const match = serverHtml.match(/<div class="chorus-md">([\s\S]*?)<\/div>/);
  return match?.[1] ?? '';
}

describe('Chorus Markdown customisation', () => {
  it('passes a custom Markdown sanitizer through the built-in renderer for stable SSR/client HTML', () => {
    const messages: Message[] = [{ id: 'a1', role: 'assistant', text: '<custom>trusted</custom>' }];
    const sanitizer = vi.fn((html: string) => html.replaceAll('<custom>', '<em>').replaceAll('</custom>', '</em>'));

    const serverHtml = renderToString(<Chorus initialMessages={messages} markdownSanitizer={sanitizer} />);
    const serverMarkdown = firstMarkdownInnerHTML(serverHtml);

    const { container } = render(<Chorus initialMessages={messages} markdownSanitizer={sanitizer} />);
    const clientMarkdown = container.querySelector('.chorus-md')?.innerHTML;

    expect(serverMarkdown).toContain('<em>trusted</em>');
    expect(clientMarkdown).toBe(serverMarkdown);

    cleanup();
  });
});
