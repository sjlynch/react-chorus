import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultFetchSSETransport } from '../hooks/assistant-session/transport';
import type { Message } from '../types';

function sentHeaders(options: RequestInit): Headers {
  return new Headers(options.headers);
}

describe('createDefaultFetchSSETransport', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('string URL form POSTs default JSON body', async () => {
    const transport = createDefaultFetchSSETransport('/api/chat');
    const history: Message[] = [{ id: '1', role: 'user', text: 'hi' }];

    await transport('hello', history, new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/chat');
    expect(options.method).toBe('POST');
    expect(options.body).toBe(JSON.stringify({ prompt: 'hello', history }));
    expect(sentHeaders(options).get('content-type')).toBe('application/json');
  });

  it('object form forwards Authorization headers alongside default Content-Type', async () => {
    const transport = createDefaultFetchSSETransport({
      url: '/api/chat',
      headers: { Authorization: 'Bearer token' },
    });

    await transport('hello', [], new AbortController().signal);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/chat');
    const headers = sentHeaders(options);
    expect(headers.get('authorization')).toBe('Bearer token');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('object form forwards credentials: "include" so cookies cross-origin', async () => {
    const transport = createDefaultFetchSSETransport({
      url: 'https://api.example.com/chat',
      credentials: 'include',
    });

    await transport('hello', [], new AbortController().signal);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.credentials).toBe('include');
  });

  it('object form supports custom formatBody and skips default Content-Type', async () => {
    const formatBody = vi.fn((text: string, history: Message[]) =>
      JSON.stringify({ latest: text, msgs: history }),
    );
    const transport = createDefaultFetchSSETransport({
      url: '/api/chat',
      formatBody,
    });
    const history: Message[] = [{ id: '1', role: 'user', text: 'hi' }];

    await transport('hello', history, new AbortController().signal);

    expect(formatBody).toHaveBeenCalledWith('hello', history);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.body).toBe(JSON.stringify({ latest: 'hello', msgs: history }));
    expect(sentHeaders(options).has('content-type')).toBe(false);
  });

  it('object form respects explicit Content-Type override', async () => {
    const transport = createDefaultFetchSSETransport({
      url: '/api/chat',
      headers: { 'Content-Type': 'application/vnd.custom+json' },
    });

    await transport('hello', [], new AbortController().signal);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentHeaders(options).get('content-type')).toBe('application/vnd.custom+json');
  });

  // Documents the footgun called out in the FetchTransportInit JSDoc and the
  // README: a caller-provided Content-Type wins verbatim, but the default
  // body is still JSON. Overriding only the header (without also overriding
  // `formatBody`) ships JSON bytes under a non-JSON media type.
  it('preserves a caller-provided Content-Type verbatim while default body stays JSON', async () => {
    const transport = createDefaultFetchSSETransport({
      url: '/api/chat',
      headers: {
        'Content-Type': 'application/x-ndjson',
        Authorization: 'Bearer token',
      },
    });
    const history: Message[] = [{ id: '1', role: 'user', text: 'hi' }];

    await transport('hello', history, new AbortController().signal);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = sentHeaders(options);
    expect(headers.get('content-type')).toBe('application/x-ndjson');
    expect(headers.get('authorization')).toBe('Bearer token');
    expect(options.body).toBe(JSON.stringify({ prompt: 'hello', history }));
    expect(() => JSON.parse(options.body as string)).not.toThrow();
  });

  it('object form forwards arbitrary RequestInit fields (cache, mode)', async () => {
    const transport = createDefaultFetchSSETransport({
      url: '/api/chat',
      cache: 'no-store',
      mode: 'cors',
    });

    await transport('hello', [], new AbortController().signal);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.cache).toBe('no-store');
    expect(options.mode).toBe('cors');
    expect(options.method).toBe('POST');
  });

  it('object form supports method: "GET" and skips body + default Content-Type', async () => {
    const formatBody = vi.fn(() => 'should-not-be-called');
    const transport = createDefaultFetchSSETransport({
      url: '/api/chat?conversation=42',
      method: 'GET',
      formatBody,
    });

    await transport('hello', [], new AbortController().signal);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/chat?conversation=42');
    expect(options.method).toBe('GET');
    expect(options.body).toBeUndefined();
    expect(sentHeaders(options).has('content-type')).toBe(false);
    expect(formatBody).not.toHaveBeenCalled();
  });

  it('object form supports method: "HEAD" without a body', async () => {
    const transport = createDefaultFetchSSETransport({
      url: '/api/chat',
      method: 'HEAD',
    });

    await transport('hello', [], new AbortController().signal);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.method).toBe('HEAD');
    expect(options.body).toBeUndefined();
    expect(sentHeaders(options).has('content-type')).toBe(false);
  });

  it('object form honors an explicit non-default body method (PUT)', async () => {
    const transport = createDefaultFetchSSETransport({
      url: '/api/chat',
      method: 'PUT',
    });
    const history: Message[] = [{ id: '1', role: 'user', text: 'hi' }];

    await transport('hello', history, new AbortController().signal);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.method).toBe('PUT');
    expect(options.body).toBe(JSON.stringify({ prompt: 'hello', history }));
    expect(sentHeaders(options).get('content-type')).toBe('application/json');
  });

  it('forwards the AbortSignal to fetch', async () => {
    const transport = createDefaultFetchSSETransport({ url: '/api/chat' });
    const controller = new AbortController();

    await transport('hello', [], controller.signal);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.signal).toBe(controller.signal);
  });
});
