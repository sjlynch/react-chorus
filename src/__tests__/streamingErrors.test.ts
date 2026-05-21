import { describe, expect, it } from 'vitest';
import { readErrorBodySnippet } from '../streaming/errors';

// Matches a surrogate code unit that is NOT part of a valid pair: a high
// surrogate not followed by a low one, or a low surrogate not preceded by a
// high one. A well-formed string (including emoji) never matches.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('readErrorBodySnippet', () => {
  it('returns the whole body when it is under the char limit', async () => {
    const snippet = await readErrorBodySnippet(new Response('upstream exploded'), 100);
    expect(snippet).toEqual({ text: 'upstream exploded', truncated: false, timedOut: false });
  });

  it('truncates an oversized body exactly at the limit on an ASCII boundary', async () => {
    const snippet = await readErrorBodySnippet(new Response('x'.repeat(50)), 10);
    expect(snippet.text).toBe('x'.repeat(10));
    expect(snippet.truncated).toBe(true);
  });

  it('truncates on a code-point boundary so the snippet never ends on a lone surrogate', async () => {
    // The 10-char limit falls in the middle of the trailing emoji's surrogate
    // pair; the high surrogate at index 9 must be dropped, not left dangling.
    const snippet = await readErrorBodySnippet(new Response(`${'x'.repeat(9)}😀`), 10);
    expect(snippet.text).toBe('x'.repeat(9));
    expect(snippet.truncated).toBe(true);
    expect(snippet.text).not.toMatch(LONE_SURROGATE);
  });

  it('keeps a surrogate pair intact when its low surrogate is the last kept unit', async () => {
    // Body is exactly the limit: the pair occupies indices 8-9, so the cut at
    // index 10 lands cleanly past the low surrogate — the emoji stays whole.
    const snippet = await readErrorBodySnippet(new Response(`${'x'.repeat(8)}😀`), 10);
    expect(snippet.text).toBe(`${'x'.repeat(8)}😀`);
    expect(snippet.text).not.toMatch(LONE_SURROGATE);
  });

  it('decodes a multi-byte character split across chunk boundaries', async () => {
    const emoji = new TextEncoder().encode('😀'); // 4 UTF-8 bytes
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(emoji.slice(0, 2));
        controller.enqueue(emoji.slice(2));
        controller.close();
      },
    });
    const snippet = await readErrorBodySnippet(new Response(stream), 100);
    expect(snippet.text).toBe('😀');
    expect(snippet.text).not.toMatch(LONE_SURROGATE);
  });
});
