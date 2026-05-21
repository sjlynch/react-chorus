import { describe, it, expect } from 'vitest';
import { readSSEStream } from '../hooks/useChorusStream';
import { ChorusStreamError } from '../streaming/errors';
import { createSSEParser } from '../streaming/readSSEStream';

function makeResponse(body: string, init?: ResponseInit): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, init);
}

function makeChunkedResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream);
}

// ---------------------------------------------------------------------------

describe('createSSEParser', () => {
  it('splits lines across chunks and dispatches a named trailing event at finish', () => {
    const frames: Array<[string, string | undefined]> = [];
    const parser = createSSEParser((payload, name) => { frames.push([payload, name]); });

    parser.push('\uFEFFevent: update\r');
    parser.push('\ndata: one\r\ndata: two');
    parser.finish();

    expect(frames).toEqual([['one\ntwo', 'update']]);
    expect(parser.getSnapshot()).toEqual({ sawDataField: true, sawSseFrame: true, stopped: false });
  });

  it('strips only one leading BOM at the start of the stream', () => {
    const frames: string[] = [];
    const parser = createSSEParser(payload => { frames.push(payload); });

    parser.push('\uFEFFdata: first\n\n\uFEFFdata: ignored\n\ndata: third\n\n');
    parser.finish();

    expect(frames).toEqual(['first', 'third']);
  });

  it('treats comments and event-only frames as SSE-shaped without dispatching payloads', () => {
    const frames: string[] = [];
    const parser = createSSEParser(payload => { frames.push(payload); });

    parser.push(': keepalive\n\nevent: heartbeat\n\n');
    parser.finish();

    expect(frames).toEqual([]);
    expect(parser.getSnapshot()).toEqual({ sawDataField: false, sawSseFrame: true, stopped: false });
  });

  it('stops parsing the current chunk when the callback returns false', () => {
    const frames: string[] = [];
    const parser = createSSEParser(payload => {
      frames.push(payload);
      return false;
    });

    parser.push('data: first\n\ndata: second\n\n');
    parser.finish();

    expect(frames).toEqual(['first']);
    expect(parser.stopped).toBe(true);
  });
});

describe('readSSEStream', () => {
  it('emits nothing for a response with no body', async () => {
    const events: string[] = [];
    await readSSEStream(new Response(null), e => events.push(e));
    expect(events).toEqual([]);
  });

  it('parses a single event', async () => {
    const events: string[] = [];
    await readSSEStream(makeResponse('data: hello\n\n'), e => events.push(e));
    expect(events).toEqual(['hello']);
  });

  it('strips a single leading UTF-8 BOM before the first event', async () => {
    const events: string[] = [];
    await readSSEStream(makeResponse('\uFEFFdata: hello\n\n'), e => events.push(e));
    expect(events).toEqual(['hello']);
  });

  it('strips one leading space after "data:"', async () => {
    const events: string[] = [];
    await readSSEStream(makeResponse('data: hello world\n\n'), e => events.push(e));
    expect(events).toEqual(['hello world']);
  });

  it('parses multiple events separated by blank lines', async () => {
    const events: string[] = [];
    const body = 'data: first\n\ndata: second\n\ndata: third\n\n';
    await readSSEStream(makeResponse(body), e => events.push(e));
    expect(events).toEqual(['first', 'second', 'third']);
  });

  it('joins multi-data-line events with newline', async () => {
    const events: string[] = [];
    const body = 'data: line one\ndata: line two\n\n';
    await readSSEStream(makeResponse(body), e => events.push(e));
    expect(events).toEqual(['line one\nline two']);
  });

  it('handles CR+LF line endings', async () => {
    const events: string[] = [];
    await readSSEStream(makeResponse('data: hello\r\n\r\n'), e => events.push(e));
    expect(events).toEqual(['hello']);
  });

  it('handles bare CR line endings', async () => {
    const events: string[] = [];
    await readSSEStream(makeResponse('data: hello\r\r'), e => events.push(e));
    expect(events).toEqual(['hello']);
  });

  it('handles bare CR line endings split across chunks', async () => {
    const events: string[] = [];
    await readSSEStream(makeChunkedResponse(['data: hel', 'lo\r', '\r']), e => events.push(e));
    expect(events).toEqual(['hello']);
  });

  it('handles CR+LF line endings split across chunks for multi-line events', async () => {
    const events: string[] = [];
    await readSSEStream(makeChunkedResponse(['data: one\r', '\ndata: two\r', '\n\r', '\n']), e => events.push(e));
    expect(events).toEqual(['one\ntwo']);
  });

  it('ignores non-data lines (event:, id:, comments)', async () => {
    const events: string[] = [];
    const body = 'event: message\nid: 1\n: comment\ndata: payload\n\n';
    await readSSEStream(makeResponse(body), e => events.push(e));
    expect(events).toEqual(['payload']);
  });

  it('handles chunk boundaries mid-line', async () => {
    // "data: hel" in one chunk, "lo\n\n" in another
    const events: string[] = [];
    await readSSEStream(makeChunkedResponse(['data: hel', 'lo\n\n']), e => events.push(e));
    expect(events).toEqual(['hello']);
  });

  it('handles chunk boundary exactly at the newline', async () => {
    const events: string[] = [];
    await readSSEStream(makeChunkedResponse(['data: hello\n', '\n']), e => events.push(e));
    expect(events).toEqual(['hello']);
  });

  it('handles many small chunks (one byte at a time)', async () => {
    const text = 'data: abc\n\n';
    const chunks = text.split('').map(c => c);
    const events: string[] = [];
    await readSSEStream(makeChunkedResponse(chunks), e => events.push(e));
    expect(events).toEqual(['abc']);
  });

  it('flushes a trailing event without a final blank line', async () => {
    // Some servers omit the trailing blank line on the last event
    const events: string[] = [];
    await readSSEStream(makeResponse('data: last'), e => events.push(e));
    expect(events).toEqual(['last']);
  });

  it('passes through the raw [DONE] sentinel unchanged', async () => {
    const events: string[] = [];
    await readSSEStream(makeResponse('data: [DONE]\n\n'), e => events.push(e));
    expect(events).toEqual(['[DONE]']);
  });

  it('handles an empty data line', async () => {
    const events: string[] = [];
    await readSSEStream(makeResponse('data:\n\n'), e => events.push(e));
    expect(events).toEqual(['']);
  });

  it('parses colonless data fields as empty data lines', async () => {
    const events: string[] = [];
    await readSSEStream(makeResponse('data\ndata: payload\n\n'), e => events.push(e));
    expect(events).toEqual(['\npayload']);
  });

  it('rejects with AbortError and cancels the body when the signal aborts', async () => {
    let cancelled = false;
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });

    const promise = readSSEStream(new Response(stream), () => undefined, controller.signal);
    controller.abort();

    await expect(promise).rejects.toThrow('Aborted');
    expect(cancelled).toBe(true);
  });

  it('rejects with a ChorusStreamError that names SSE/data and the Content-Type when a 200 JSON body has no data lines', async () => {
    const res = makeResponse(JSON.stringify({ error: 'missing API key' }), {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    });

    const events: string[] = [];
    const promise = readSSEStream(res, e => events.push(e));

    await expect(promise).rejects.toBeInstanceOf(ChorusStreamError);
    await expect(promise).rejects.toThrow(/Server-Sent Events/);
    await expect(promise).rejects.toThrow(/`data:` lines/);
    await expect(promise).rejects.toThrow(/application\/json/);
    await expect(promise).rejects.toThrow(/missing API key/);
    expect(events).toEqual([]);
  });

  it('rejects with a ChorusStreamError when a 200 text/plain body has no data lines', async () => {
    const res = makeResponse('hello from the wrong endpoint', {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });

    const events: string[] = [];
    const promise = readSSEStream(res, e => events.push(e));

    await expect(promise).rejects.toBeInstanceOf(ChorusStreamError);
    await expect(promise).rejects.toThrow(/Server-Sent Events/);
    await expect(promise).rejects.toThrow(/text\/plain/);
    await expect(promise).rejects.toThrow(/hello from the wrong endpoint/);
    expect(events).toEqual([]);
  });

  it('truncates long malformed-body previews in the error message', async () => {
    const body = 'x'.repeat(2000);
    const res = makeResponse(body, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });

    const promise = readSSEStream(res, () => undefined);

    await expect(promise).rejects.toThrow(/x+…/);
    await promise.catch((err: Error) => {
      expect(err.message.length).toBeLessThan(500);
    });
  });

  it('resolves silently for an empty body with no events (preserves valid empty streams)', async () => {
    const empty = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.close(); },
    }));

    const events: string[] = [];
    await expect(readSSEStream(empty, e => events.push(e))).resolves.toBeUndefined();
    expect(events).toEqual([]);
  });

  it('does not throw a malformed-SSE error for a whitespace-only body', async () => {
    const res = makeResponse('\n\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    const events: string[] = [];
    await expect(readSSEStream(res, e => events.push(e))).resolves.toBeUndefined();
    expect(events).toEqual([]);
  });

  it('captures the event: name and passes it as the second onEvent argument', async () => {
    const frames: Array<[string, string | undefined]> = [];
    const body =
      'event: error\nid: 1\nretry: 1000\ndata: rate limited\n\n' +
      'event: heartbeat\ndata: {}\n\n' +
      ': keepalive\ndata: plain\n\n';
    await readSSEStream(makeResponse(body), (payload, name) => { frames.push([payload, name]); });
    expect(frames).toEqual([
      ['rate limited', 'error'],
      ['{}', 'heartbeat'],
      // The event-type buffer resets after each dispatch, so this frame has no name.
      ['plain', undefined],
    ]);
  });

  it('does not dispatch a named event: frame that carries no data line', async () => {
    const frames: Array<[string, string | undefined]> = [];
    await readSSEStream(makeResponse('event: heartbeat\n\ndata: real\n\n'), (payload, name) => {
      frames.push([payload, name]);
    });
    expect(frames).toEqual([['real', undefined]]);
  });

  it('resolves without error for a text/event-stream that contains only a keepalive comment', async () => {
    const res = makeResponse(': keepalive\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    const events: string[] = [];
    await expect(readSSEStream(res, e => events.push(e))).resolves.toBeUndefined();
    expect(events).toEqual([]);
  });

  it('resolves without error for a text/event-stream that contains only named event lines', async () => {
    const res = makeResponse('event: heartbeat\n\nevent: heartbeat\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });
    const events: string[] = [];
    await expect(readSSEStream(res, e => events.push(e))).resolves.toBeUndefined();
    expect(events).toEqual([]);
  });

  it('still rejects a text/event-stream body that has a JSON error and no SSE-shaped lines', async () => {
    const res = makeResponse(JSON.stringify({ error: 'quota exceeded' }), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    const promise = readSSEStream(res, () => undefined);
    await expect(promise).rejects.toBeInstanceOf(ChorusStreamError);
    await expect(promise).rejects.toThrow(/Server-Sent Events/);
  });

  it('stops reading and cancels the body when the callback returns false', async () => {
    const events: string[] = [];
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: first\n\ndata: second\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });

    await readSSEStream(new Response(stream), e => {
      events.push(e);
      return false;
    });

    expect(events).toEqual(['first']);
    expect(cancelled).toBe(true);
  });
});
