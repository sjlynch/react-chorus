import { describe, expect, it } from 'vitest';
import {
  encodeSSEDone,
  encodeSSEError,
  encodeSSEEvent,
  formatSSEDone,
  formatSSEError,
  formatSSEEvent,
  sseHeaders,
} from '../server';
import { readSSEStream } from '../streaming/readSSEStream';

const decoder = new TextDecoder();

function fromString(text: string): Response {
  return new Response(new TextEncoder().encode(text));
}

async function collectEvents(text: string): Promise<string[]> {
  const events: string[] = [];
  await readSSEStream(fromString(text), payload => {
    events.push(payload);
  });
  return events;
}

describe('sseHeaders', () => {
  it('includes the proxy-buffering and no-transform settings every Chorus proxy needs', () => {
    expect(sseHeaders['Content-Type']).toMatch(/^text\/event-stream/);
    expect(sseHeaders['Cache-Control']).toContain('no-transform');
    expect(sseHeaders['X-Accel-Buffering']).toBe('no');
  });

  it('is frozen so consumers cannot mutate the shared headers object', () => {
    expect(Object.isFrozen(sseHeaders)).toBe(true);
  });
});

describe('formatSSEEvent / encodeSSEEvent', () => {
  it('JSON.stringifies object payloads and terminates the event with a blank line', () => {
    const chunk = { choices: [{ delta: { content: 'hello' } }] };
    const text = formatSSEEvent(chunk);
    expect(text).toBe(`data: ${JSON.stringify(chunk)}\n\n`);
  });

  it('round-trips a JSON event through readSSEStream', async () => {
    const chunk = { id: 'cmpl-1', choices: [{ delta: { content: 'hi' } }] };
    const events = await collectEvents(formatSSEEvent(chunk));
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0])).toEqual(chunk);
  });

  it('encodeSSEEvent emits UTF-8 bytes that decode back to the same text', () => {
    const bytes = encodeSSEEvent({ text: 'hi' });
    // jsdom has its own Uint8Array realm so cross-realm `instanceof` is unreliable; compare by tag.
    expect(Object.prototype.toString.call(bytes)).toBe('[object Uint8Array]');
    expect(decoder.decode(bytes)).toBe(formatSSEEvent({ text: 'hi' }));
  });

  it('passes raw strings through verbatim (no JSON quoting) so sentinels survive', () => {
    expect(formatSSEEvent('[DONE]')).toBe('data: [DONE]\n\n');
  });
});

describe('multiline string payloads', () => {
  it('emits one `data:` line per line of the value per the SSE spec', () => {
    const formatted = formatSSEEvent('first line\nsecond line\nthird line');
    expect(formatted).toBe('data: first line\ndata: second line\ndata: third line\n\n');
  });

  it('normalizes CRLF and bare CR to LF before splitting', () => {
    expect(formatSSEEvent('a\r\nb\rc')).toBe('data: a\ndata: b\ndata: c\n\n');
  });

  it('preserves blank lines inside a multiline payload as empty `data:` lines', () => {
    expect(formatSSEEvent('first\n\nsecond')).toBe('data: first\ndata: \ndata: second\n\n');
  });

  it('round-trips a multiline string back through the SSE reader', async () => {
    const payload = 'line one\nline two\n\nline four';
    const events = await collectEvents(formatSSEEvent(payload));
    expect(events).toEqual([payload]);
  });
});

describe('formatSSEDone / encodeSSEDone', () => {
  it('emits the canonical OpenAI-style [DONE] sentinel by default', () => {
    expect(formatSSEDone()).toBe('data: [DONE]\n\n');
  });

  it('supports a caller-supplied done token', () => {
    expect(formatSSEDone('stop')).toBe('data: stop\n\n');
  });

  it('encodeSSEDone matches formatSSEDone byte-for-byte', () => {
    expect(decoder.decode(encodeSSEDone())).toBe(formatSSEDone());
  });

  it('reads back through the SSE reader as the literal `[DONE]` string', async () => {
    const events = await collectEvents(formatSSEDone());
    expect(events).toEqual(['[DONE]']);
  });
});

describe('formatSSEError / encodeSSEError', () => {
  it('wraps Error.message in the in-band `{ error }` envelope Chorus connectors expect', () => {
    const payload = formatSSEError(new Error('upstream timeout'));
    expect(payload).toBe(`data: ${JSON.stringify({ error: 'upstream timeout' })}\n\n`);
  });

  it('passes a plain string error through as the message', () => {
    expect(formatSSEError('rate limited')).toBe(`data: ${JSON.stringify({ error: 'rate limited' })}\n\n`);
  });

  it('coerces non-Error, non-string values via String(...)', () => {
    expect(formatSSEError({ code: 500 })).toBe(`data: ${JSON.stringify({ error: '[object Object]' })}\n\n`);
    expect(formatSSEError(null)).toBe(`data: ${JSON.stringify({ error: 'null' })}\n\n`);
  });

  it('escapes embedded newlines as JSON so the envelope stays a single SSE event', async () => {
    const events = await collectEvents(formatSSEError('boom\nstack frame'));
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0])).toEqual({ error: 'boom\nstack frame' });
  });

  it('encodeSSEError matches formatSSEError byte-for-byte', () => {
    const error = new Error('nope');
    expect(decoder.decode(encodeSSEError(error))).toBe(formatSSEError(error));
  });
});
