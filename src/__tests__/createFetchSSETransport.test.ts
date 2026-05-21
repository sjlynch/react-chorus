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

  it('defaults to method POST', async () => {
    const transport = createFetchSSETransport('https://api.example.com/chat');

    await transport('hello', [], new AbortController().signal);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.method).toBe('POST');
  });

  it('uses GET with no body when method: "GET" is passed', async () => {
    const transport = createFetchSSETransport('https://api.example.com/chat?prompt=hello', {
      method: 'GET',
    });

    await transport('hello', [], new AbortController().signal);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.method).toBe('GET');
    expect(options.body).toBeUndefined();
    expect(sentHeaders(options).has('content-type')).toBe(false);
  });

  it('skips formatBody and warns in dev when method is GET', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const formatBody = vi.fn(() => 'should-not-be-called');
    const transport = createFetchSSETransport('https://api.example.com/chat', {
      method: 'GET',
      formatBody,
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("`formatBody` was provided together with `method: 'GET'`"),
    );

    await transport('hello', [], new AbortController().signal);

    expect(formatBody).not.toHaveBeenCalled();
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.body).toBeUndefined();
    warn.mockRestore();
  });

  it('forwards custom method like PUT with a body', async () => {
    const transport = createFetchSSETransport('https://api.example.com/chat', {
      method: 'PUT',
    });

    await transport('hello', [], new AbortController().signal);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.method).toBe('PUT');
    expect(options.body).toBe(JSON.stringify({ prompt: 'hello', history: [] }));
    expect(sentHeaders(options).get('content-type')).toBe('application/json');
  });
});

describe('createFetchSSETransport formatBody / body-less method dev warning', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // `createFetchSSETransport` warns at most once per process, so each case
  // re-imports the module to get a fresh warn-once flag.
  async function freshCreateFetchSSETransport() {
    vi.resetModules();
    return (await import('../streaming/createFetchSSETransport')).createFetchSSETransport;
  }

  it('warns once in dev when formatBody is paired with a body-less method', async () => {
    process.env.NODE_ENV = 'development';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const create = await freshCreateFetchSSETransport();
    const formatBody = () => JSON.stringify({});

    create('https://api.example.com/chat?prompt=hi', { method: 'GET', formatBody });
    create('https://api.example.com/chat?prompt=hi', { method: 'HEAD', formatBody });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`formatBody`'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("method: 'GET'"));
  });

  it('does not warn when formatBody is paired with a body-carrying method', async () => {
    process.env.NODE_ENV = 'development';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const create = await freshCreateFetchSSETransport();

    create('https://api.example.com/chat', { method: 'POST', formatBody: () => '{}' });
    create('https://api.example.com/chat', { formatBody: () => '{}' });

    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn for a body-less method without a formatBody serializer', async () => {
    process.env.NODE_ENV = 'development';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const create = await freshCreateFetchSSETransport();

    create('https://api.example.com/chat?prompt=hi', { method: 'GET' });

    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn in production', async () => {
    process.env.NODE_ENV = 'production';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const create = await freshCreateFetchSSETransport();

    create('https://api.example.com/chat?prompt=hi', { method: 'GET', formatBody: () => '{}' });

    expect(warn).not.toHaveBeenCalled();
  });
});
