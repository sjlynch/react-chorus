import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFetchSSETransport } from '../streaming/createFetchSSETransport';
import type { Message } from '../types';

function sentHeaders(options: RequestInit): Headers {
  return new Headers(options.headers);
}

describe('createFetchSSETransport', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs default JSON body with prompt and history', async () => {
    const transport = createFetchSSETransport('https://api.example.com/chat');
    const history: Message[] = [{ id: '1', role: 'user', text: 'hi' }];

    await transport('hello', history, new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/chat');
    expect(options.body).toBe(JSON.stringify({ prompt: 'hello', history }));
  });

  it('uses custom formatBody when provided', async () => {
    const formatBody = vi.fn(
      (text: string, history: Message[]) =>
        JSON.stringify({ model: 'gpt-4o', messages: history, latest: text, stream: true }),
    );
    const transport = createFetchSSETransport('https://api.example.com/chat', { formatBody });
    const history: Message[] = [{ id: '1', role: 'user', text: 'hi' }];

    await transport('hello', history, new AbortController().signal);

    expect(formatBody).toHaveBeenCalledWith('hello', history);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.body).toBe(
      JSON.stringify({ model: 'gpt-4o', messages: history, latest: 'hello', stream: true }),
    );
    expect(options.body).not.toContain('"prompt"');
    expect(sentHeaders(options).has('content-type')).toBe(false);
  });

  it('forwards plain object headers alongside default Content-Type', async () => {
    const transport = createFetchSSETransport('https://api.example.com/chat', {
      headers: { Authorization: 'Bearer token' },
    });

    await transport('hello', [], new AbortController().signal);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = sentHeaders(options);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('authorization')).toBe('Bearer token');
  });

  it('preserves Headers instance headers alongside default Content-Type', async () => {
    const transport = createFetchSSETransport('https://api.example.com/chat', {
      headers: new Headers([['Authorization', 'Bearer from-headers']]),
    });

    await transport('hello', [], new AbortController().signal);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = sentHeaders(options);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('authorization')).toBe('Bearer from-headers');
  });

  it('preserves tuple-array headers alongside default Content-Type', async () => {
    const transport = createFetchSSETransport('https://api.example.com/chat', {
      headers: [['X-Trace-Id', 'trace-123']],
    });

    await transport('hello', [], new AbortController().signal);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = sentHeaders(options);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-trace-id')).toBe('trace-123');
  });

  it('respects explicit Content-Type overrides', async () => {
    const transport = createFetchSSETransport('https://api.example.com/chat', {
      headers: { 'Content-Type': 'application/vnd.custom+json' },
    });

    await transport('hello', [], new AbortController().signal);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentHeaders(options).get('content-type')).toBe('application/vnd.custom+json');
  });

  it('does not force JSON Content-Type for FormData bodies', async () => {
    const form = new FormData();
    form.append('prompt', 'hello');
    const transport = createFetchSSETransport('https://api.example.com/chat', {
      formatBody: () => form,
    });

    await transport('hello', [], new AbortController().signal);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.body).toBe(form);
    expect(sentHeaders(options).has('content-type')).toBe(false);
  });

  it('adds Content-Type: application/json by default when no headers are passed', async () => {
    const transport = createFetchSSETransport('https://api.example.com/chat');

    await transport('hello', [], new AbortController().signal);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentHeaders(options).get('content-type')).toBe('application/json');
  });

  it('forwards AbortSignal to fetch', async () => {
    const transport = createFetchSSETransport('https://api.example.com/chat');
    const controller = new AbortController();

    await transport('hello', [], controller.signal);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.signal).toBe(controller.signal);
  });

  it('always calls fetch with method POST', async () => {
    const transport = createFetchSSETransport('https://api.example.com/chat');

    await transport('hello', [], new AbortController().signal);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.method).toBe('POST');
  });
});
