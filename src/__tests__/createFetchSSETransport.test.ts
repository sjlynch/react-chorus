import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFetchSSETransport } from '../streaming/createFetchSSETransport';
import type { Message } from '../types';

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
    const [url, options] = fetchMock.mock.calls[0];
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
    const [, options] = fetchMock.mock.calls[0];
    expect(options.body).toBe(
      JSON.stringify({ model: 'gpt-4o', messages: history, latest: 'hello', stream: true }),
    );
    expect(options.body).not.toContain('"prompt"');
  });

  it('forwards custom headers alongside Content-Type', async () => {
    const transport = createFetchSSETransport('https://api.example.com/chat', {
      headers: { Authorization: 'Bearer token' },
    });

    await transport('hello', [], new AbortController().signal);

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer token',
    });
  });

  it('adds Content-Type: application/json by default when no headers are passed', async () => {
    const transport = createFetchSSETransport('https://api.example.com/chat');

    await transport('hello', [], new AbortController().signal);

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('forwards AbortSignal to fetch', async () => {
    const transport = createFetchSSETransport('https://api.example.com/chat');
    const controller = new AbortController();

    await transport('hello', [], controller.signal);

    const [, options] = fetchMock.mock.calls[0];
    expect(options.signal).toBe(controller.signal);
  });

  it('always calls fetch with method POST', async () => {
    const transport = createFetchSSETransport('https://api.example.com/chat');

    await transport('hello', [], new AbortController().signal);

    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('POST');
  });
});
