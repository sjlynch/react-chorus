import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus, type ChorusOnSend, type ChorusProps, type ChorusRef, type ChorusSendHelpers, type Transport } from '../Chorus';
import { useChorusStream } from '../hooks/useChorusStream';
import { toAnthropicMessagesBody, toOpenAIChatCompletionsBody } from '../providerRequests';
import type { Message, StorageAdapter } from '../types';

type OnSend = ChorusOnSend;
type OnSendHelpers = ChorusSendHelpers;

vi.mock('../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

function sseResponse(chunks: string[], status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
      }
      controller.close();
    },
  });

  return new Response(body, { status });
}

function erroringSSEResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(`data: ${chunks[index]}\n\n`));
        index += 1;
        return;
      }
      controller.error(new Error('stream exploded'));
    },
  });

  return new Response(body, { status: 200 });
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeSyncStorage(initial: Record<string, string> = {}): StorageAdapter & { store: Record<string, string> } {
  const store = { ...initial };
  return {
    store,
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => { store[key] = value; },
  };
}

describe('Chorus', () => {
  it('applies className, style, palette variables, and HTML attributes to the root element', () => {
    const { container } = render(
      <Chorus
        id="chorus-root"
        data-testid="chorus-root"
        className="my-chat"
        style={{ height: '500px' }}
        palette={{
          chatBg: '#000',
          actionText: '#111',
          actionHoverBg: '#222',
          actionHoverText: '#333',
          errorBg: '#444',
          errorBorder: '#555',
          errorText: '#666',
          toolHeaderBg: '#777',
        }}
      />
    );

    const root = container.firstElementChild as HTMLElement;

    expect(root).toHaveClass('chorus', 'my-chat');
    expect(root).toHaveAttribute('id', 'chorus-root');
    expect(root).toHaveAttribute('data-testid', 'chorus-root');
    expect(root.style.height).toBe('500px');
    expect(root.style.getPropertyValue('--chorus-chat-bg')).toBe('#000');
    expect(root.style.getPropertyValue('--chorus-action-text')).toBe('#111');
    expect(root.style.getPropertyValue('--chorus-action-hover-bg')).toBe('#222');
    expect(root.style.getPropertyValue('--chorus-action-hover-text')).toBe('#333');
    expect(root.style.getPropertyValue('--chorus-error-bg')).toBe('#444');
    expect(root.style.getPropertyValue('--chorus-error-border')).toBe('#555');
    expect(root.style.getPropertyValue('--chorus-error-text')).toBe('#666');
    expect(root.style.getPropertyValue('--chorus-tool-header-bg')).toBe('#777');
  });

  it('adds the chorus--always-show-actions root class when alwaysShowMessageActions is enabled', () => {
    const { container, rerender } = render(<Chorus />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).not.toHaveClass('chorus--always-show-actions');

    rerender(<Chorus alwaysShowMessageActions />);
    expect(root).toHaveClass('chorus', 'chorus--always-show-actions');
  });

  it('seeds feedback through getMessageFeedback', () => {
    const message: Message<{ storedFeedback: 'down' | null }> = {
      id: 'stored-feedback',
      role: 'assistant',
      text: 'Persisted reply',
      metadata: { storedFeedback: 'down' },
    };

    render(
      <Chorus
        initialMessages={[message]}
        onFeedback={vi.fn()}
        getMessageFeedback={(m) => m.metadata?.storedFeedback === 'down' ? 'down' : null}
      />
    );

    expect(screen.getByRole('button', { name: 'Thumbs down' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('exposes an imperative ChorusRef for send, focus, clear, stop, and scrollToMessage', async () => {
    const ref = React.createRef<ChorusRef>();
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const onSend = vi.fn<OnSend>(async () => ({ id: 'a1', role: 'assistant', text: 'ref reply' }));

    render(<Chorus ref={ref} onSend={onSend} minAssistantDelayMs={0} showClearButton />);

    act(() => ref.current?.focus());
    expect(screen.getByRole('textbox')).toHaveFocus();

    act(() => ref.current?.send('hi from ref'));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('hi from ref', expect.any(Array), expect.any(Object)));
    expect(await screen.findByText('ref reply')).toBeInTheDocument();
    expect(ref.current?.getMessages()).toEqual([
      expect.objectContaining({ role: 'user', text: 'hi from ref' }),
      expect.objectContaining({ id: 'a1', role: 'assistant', text: 'ref reply' }),
    ]);

    let scrolled: boolean | undefined;
    act(() => { scrolled = ref.current?.scrollToMessage('a1'); });
    expect(scrolled).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });

    act(() => ref.current?.stop());
    act(() => ref.current?.clear());
    expect(ref.current?.getMessages()).toEqual([]);
    expect(screen.queryByText('hi from ref')).not.toBeInTheDocument();
  });

  it('scrollToMessage targets custom renderMessage rows that spread messageProps', () => {
    const ref = React.createRef<ChorusRef>();
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(
      <Chorus
        ref={ref}
        messages={[{ id: 'a1', role: 'assistant', text: 'Custom reply' }]}
        renderMessage={(message, ctx) => (
          <article {...ctx.messageProps} data-testid="custom-message">
            {message.text}
          </article>
        )}
      />
    );

    const customMessage = screen.getByTestId('custom-message');
    let scrolled: boolean | undefined;
    act(() => { scrolled = ref.current?.scrollToMessage('a1'); });

    expect(scrolled).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(scrollIntoView.mock.contexts[0]).toBe(customMessage);
  });

  it('scrollToMessage returns false when the id is not among rendered messages', () => {
    const ref = React.createRef<ChorusRef>();
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(
      <Chorus
        ref={ref}
        messages={[
          { id: 's1', role: 'system', text: 'Hidden system prompt' },
          { id: 'u1', role: 'user', text: 'Visible user message' },
        ]}
      />
    );

    expect(screen.queryByText('Hidden system prompt')).not.toBeInTheDocument();

    let hiddenResult: boolean | undefined;
    act(() => { hiddenResult = ref.current?.scrollToMessage('s1'); });
    let missingResult: boolean | undefined;
    act(() => { missingResult = ref.current?.scrollToMessage('missing-id'); });

    expect(hiddenResult).toBe(false);
    expect(missingResult).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('transport path send() fires transport and streams tokens into the message list', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse(['Hel', 'lo']));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'hi');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(transport).toHaveBeenCalledOnce());
    expect(transport.mock.calls[0][0]).toBe('hi');
    expect(screen.getByText('hi')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Hello')).toBeInTheDocument());
  });

  it('renders streamed reasoning in a collapsed details block on the assistant message', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: 'plan first' } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: { content: 'final answer' } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'why');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('final answer')).toBeInTheDocument();
    const summary = screen.getByText('Reasoning');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('plan first')).toBeInTheDocument();
  });

  it('renders streamed connector tool calls as visible tool rows by default', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":' } }] } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"test"}' } }] } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'use a tool');
    await user.click(screen.getByRole('button', { name: /send/i }));

    const toolButton = await screen.findByRole('button', { name: /search/i });
    expect(toolButton).toBeInTheDocument();
    await user.click(toolButton);
    expect(screen.getByText(/"q": "test"/)).toBeInTheDocument();
  });

  it('finishes a tool-only OpenAI stream without stale typing and reports stream completion', async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    const onStreamDone = vi.fn();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":"test"}' } }] } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} onFinish={onFinish} onStreamDone={onStreamDone} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'use a tool');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('button', { name: /search/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(screen.queryByRole('status', { name: /assistant is typing/i })).not.toBeInTheDocument();
    expect(onFinish).not.toHaveBeenCalled();
    expect(onStreamDone).toHaveBeenCalledWith(expect.objectContaining({
      assistantMessage: null,
      toolMessages: [expect.objectContaining({ role: 'tool', toolCall: expect.objectContaining({ id: 'call_1', name: 'search', input: { q: 'test' } }) })],
      response: expect.any(Response),
    }));
  });

  it('finishes a tool-only Anthropic stream and invokes onToolCall with actionable context', async () => {
    const user = userEvent.setup();
    const onToolCall = vi.fn();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'lookup', input: {} } }),
      JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"city":"Paris"}' } }),
      JSON.stringify({ type: 'message_stop' }),
    ]));

    render(<Chorus transport={transport} connector="anthropic" minAssistantDelayMs={0} onToolCall={onToolCall} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'use anthropic tool');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('button', { name: /lookup/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(onToolCall).toHaveBeenCalledWith(expect.objectContaining({
      id: 'toolu_1',
      name: 'lookup',
      input: { city: 'Paris' },
      signal: expect.any(AbortSignal),
      message: expect.objectContaining({ role: 'tool' }),
      messages: expect.any(Array),
    }));
    expect(screen.queryByRole('status', { name: /assistant is typing/i })).not.toBeInTheDocument();
  });

  it('executes a streamed tool call and keeps final assistant text', async () => {
    const user = userEvent.setup();
    const search = vi.fn(async () => ({ results: ['first result'] }));
    const onFinish = vi.fn();
    const onToolDelta = vi.fn();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":"react"}' } }] } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: { content: 'I found one result.' } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} tools={{ search }} onFinish={onFinish} onToolDelta={onToolDelta} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'search react');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('I found one result.')).toBeInTheDocument();
    await waitFor(() => expect(search).toHaveBeenCalledWith({ q: 'react' }, expect.objectContaining({ id: 'call_1', name: 'search' })));
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ message: expect.objectContaining({ text: 'I found one result.' }) })));
    expect(onToolDelta).toHaveBeenCalledWith(expect.objectContaining({ delta: expect.objectContaining({ id: 'call_1' }) }));

    const toolButton = screen.getByRole('button', { name: /search/i });
    await user.click(toolButton);
    expect(screen.getByText(/first result/)).toBeInTheDocument();
  });

  it('renders and executes every parallel tool call in one provider chunk', async () => {
    const user = userEvent.setup();
    const search = vi.fn(async () => ({ ok: 'search' }));
    const lookup = vi.fn(async () => ({ ok: 'lookup' }));
    const onToolDelta = vi.fn();
    const onStreamDone = vi.fn();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { content: 'running tools', tool_calls: [
        { index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":"react"}' } },
        { index: 1, id: 'call_2', function: { name: 'lookup', arguments: '{"id":2}' } },
      ] } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} tools={{ search, lookup }} onToolDelta={onToolDelta} onStreamDone={onStreamDone} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'parallel tools');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('running tools')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /search/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /lookup/i })).toBeInTheDocument();
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(onToolDelta).toHaveBeenCalledTimes(2);
    expect(onStreamDone).toHaveBeenCalledWith(expect.objectContaining({
      toolMessages: expect.arrayContaining([
        expect.objectContaining({ toolCall: expect.objectContaining({ id: 'call_1' }) }),
        expect.objectContaining({ toolCall: expect.objectContaining({ id: 'call_2' }) }),
      ]),
    }));
  });

  it('surfaces tool execution failures and appends error output', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":"react"}' } }] } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} tools={{ search: async () => { throw new Error('tool failed'); } }} onError={onError} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'search react');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'tool failed' })));
    const toolButton = screen.getByRole('button', { name: /search/i });
    await user.click(toolButton);
    expect(screen.getByText(/tool failed/)).toBeInTheDocument();
  });

  it('removes stale failed tool output before retrying', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => (
      transport.mock.calls.length === 1
        ? sseResponse([
          JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":"react"}' } }] } }] }),
          '[DONE]',
        ])
        : sseResponse([
          JSON.stringify({ choices: [{ index: 0, delta: { content: 'fresh success' } }] }),
          '[DONE]',
        ])
    ));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} tools={{ search: async () => { throw new Error('tool failed'); } }} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'search react');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /search/i }));
    expect(screen.getByText(/tool failed/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /retry/i }));

    expect(await screen.findByText('fresh success')).toBeInTheDocument();
    expect(screen.queryByText(/tool failed/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /search/i })).not.toBeInTheDocument();
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('aborts during tool execution without showing an error', async () => {
    const user = userEvent.setup();
    let capturedSignal!: AbortSignal;
    const onError = vi.fn();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'slow_tool', arguments: '{"q":"react"}' } }] } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} tools={{
      slow_tool: (_input, context) => {
        capturedSignal = context.signal;
        return new Promise((_resolve, reject) => {
          context.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
      },
    }} onError={onError} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'slow tool');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('button', { name: /slow_tool/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /stop/i }));

    await waitFor(() => expect(capturedSignal.aborted).toBe(true));
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(onError).not.toHaveBeenCalled();
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
  });

  it('auto-continues OpenAI tool calls with provider ids in continuation history', async () => {
    const user = userEvent.setup();
    const search = vi.fn(async () => ({ result: 'found' }));
    const transport = vi.fn<Transport>(async () => (
      transport.mock.calls.length === 1
        ? sseResponse([
          JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_openai', function: { name: 'search', arguments: '{"q":"react"}' } }] } }] }),
          '[DONE]',
        ])
        : sseResponse([
          JSON.stringify({ choices: [{ index: 0, delta: { content: 'final answer' } }] }),
          '[DONE]',
        ])
    ));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} autoContinueTools tools={{ search }} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'search react');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('final answer')).toBeInTheDocument();
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    expect(search).toHaveBeenCalledWith({ q: 'react' }, expect.objectContaining({ id: 'call_openai' }));

    const continuationBody = toOpenAIChatCompletionsBody(transport.mock.calls[1][1]);
    expect(continuationBody.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        tool_calls: [expect.objectContaining({ id: 'call_openai', function: expect.objectContaining({ name: 'search' }) })],
      }),
      expect.objectContaining({ role: 'tool', tool_call_id: 'call_openai', content: expect.stringContaining('found') }),
    ]));
  });

  it('auto-continues Anthropic tool calls with tool_use history', async () => {
    const user = userEvent.setup();
    const lookup = vi.fn(async () => ({ weather: 'sunny' }));
    const transport = vi.fn<Transport>(async () => (
      transport.mock.calls.length === 1
        ? sseResponse([
          JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'lookup', input: {} } }),
          JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"city":"Paris"}' } }),
          JSON.stringify({ type: 'message_stop' }),
        ])
        : sseResponse([
          JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'It is sunny.' } }),
          JSON.stringify({ type: 'message_stop' }),
        ])
    ));

    render(<Chorus transport={transport} connector="anthropic" minAssistantDelayMs={0} autoContinueTools tools={{ lookup }} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'weather');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('It is sunny.')).toBeInTheDocument();
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    expect(lookup).toHaveBeenCalledWith({ city: 'Paris' }, expect.objectContaining({ id: 'toolu_1' }));

    const continuationBody = toAnthropicMessagesBody(transport.mock.calls[1][1]);
    expect(continuationBody.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        content: expect.arrayContaining([expect.objectContaining({ type: 'tool_use', id: 'toolu_1', name: 'lookup' })]),
      }),
      expect.objectContaining({
        role: 'user',
        content: [expect.objectContaining({ type: 'tool_result', tool_use_id: 'toolu_1', content: expect.stringContaining('sunny') })],
      }),
    ]));
  });

  it('stops automatic tool loops at maxToolIterations', async () => {
    const user = userEvent.setup();
    const search = vi.fn(async () => ({ ok: true }));
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: transport.mock.calls.length - 1, id: `call_${transport.mock.calls.length}`, function: { name: 'search', arguments: '{}' } }] } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} autoContinueTools maxToolIterations={1} tools={{ search }} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'loop');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(search).toHaveBeenCalledTimes(2);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('treats maxToolIterations={Infinity} as an explicit unlimited cap', async () => {
    const user = userEvent.setup();
    const search = vi.fn(async () => ({ ok: true }));
    const shouldContinueToolLoop = vi.fn(context => context.iteration < 6);
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: transport.mock.calls.length - 1, id: `call_${transport.mock.calls.length}`, function: { name: 'search', arguments: '{}' } }] } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} autoContinueTools maxToolIterations={Infinity} tools={{ search }} shouldContinueToolLoop={shouldContinueToolLoop} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'loop');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(6));
    expect(shouldContinueToolLoop).toHaveBeenLastCalledWith(expect.objectContaining({ iteration: 6, maxToolIterations: Infinity }));
  });

  it('lets shouldContinueToolLoop veto automatic continuation', async () => {
    const user = userEvent.setup();
    const search = vi.fn(async () => ({ ok: true }));
    const shouldContinueToolLoop = vi.fn(() => false);
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{}' } }] } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} autoContinueTools tools={{ search }} shouldContinueToolLoop={shouldContinueToolLoop} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'veto');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(shouldContinueToolLoop).toHaveBeenCalledWith(expect.objectContaining({
      iteration: 1,
      maxToolIterations: 4,
      toolMessages: [expect.objectContaining({ toolCall: expect.objectContaining({ id: 'call_1' }) })],
      signal: expect.any(AbortSignal),
    }));
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('Stop aborts an active automatic continuation stream', async () => {
    const user = userEvent.setup();
    let continuationSignal!: AbortSignal;
    const search = vi.fn(async () => ({ ok: true }));
    const transport = vi.fn<Transport>(async (_text, _history, signal) => {
      if (transport.mock.calls.length === 1) {
        return sseResponse([
          JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{}' } }] } }] }),
          '[DONE]',
        ]);
      }
      continuationSignal = signal;
      return new Response(new ReadableStream<Uint8Array>());
    });

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} autoContinueTools tools={{ search }} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'continue then stop');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /stop/i }));

    await waitFor(() => expect(continuationSignal.aborted).toBe(true));
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
  });

  it('allows custom rendering of streamed tool messages while preserving default rendering', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":"react"}' } }] } }] }),
      '[DONE]',
    ]));

    render(<Chorus
      transport={transport}
      connector="openai"
      minAssistantDelayMs={0}
      renderMessage={(message, context) => message.role === 'tool'
        ? <div data-testid="custom-tool">Custom {message.toolCall?.name}{context.defaultRender()}</div>
        : context.defaultRender()}
    />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'search react');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByTestId('custom-tool')).toHaveTextContent('Custom search');
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
  });

  it('accepts a custom connector object on the transport path', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse(['ignored']));

    render(<Chorus transport={transport} connector={{ name: 'custom', extract: () => ({ text: 'X' }) }} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'hi');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('X')).toBeInTheDocument();
  });

  it('delays the first transport token until minAssistantDelayMs elapses', async () => {
    vi.useFakeTimers();
    try {
      const transport = vi.fn<Transport>(async () => sseResponse(['Delayed']));

      render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={500} />);

      fireEvent.change(screen.getByPlaceholderText('Send a message'), { target: { value: 'hi' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(transport).toHaveBeenCalledOnce();
      expect(screen.getByText('hi')).toBeInTheDocument();
      expect(screen.queryByText('Delayed')).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(499);
      });
      expect(screen.queryByText('Delayed')).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByText('Delayed')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('delays custom onSend helper chunks until minAssistantDelayMs elapses', async () => {
    vi.useFakeTimers();
    try {
      const onSend = vi.fn<OnSend>((_text, _messages, helpers) => {
        helpers.appendAssistant('Delayed helper');
        helpers.finalizeAssistant();
      });

      render(<Chorus onSend={onSend} minAssistantDelayMs={500} />);

      fireEvent.change(screen.getByPlaceholderText('Send a message'), { target: { value: 'hi' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(onSend).toHaveBeenCalledOnce();
      expect(screen.queryByText('Delayed helper')).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(499);
      });
      expect(screen.queryByText('Delayed helper')).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByText('Delayed helper')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders initialMessages in uncontrolled mode', () => {
    render(<Chorus initialMessages={[{ id: 'welcome', role: 'assistant', text: 'Welcome!' }]} />);

    expect(screen.getByText('Welcome!')).toBeInTheDocument();
  });

  it('observes uncontrolled initial messages, streams, and clear without requiring controlled state', async () => {
    const user = userEvent.setup();
    const onMessagesChange = vi.fn();
    const onSend = vi.fn<OnSend>(async (_text, _messages, helpers) => {
      helpers.appendAssistant('streamed ');
      helpers.appendAssistant('reply');
      helpers.finalizeAssistant();
    });

    render(
      <Chorus
        initialMessages={[{ id: 'welcome', role: 'assistant', text: 'Welcome!' }]}
        onMessagesChange={onMessagesChange}
        onSend={onSend}
        minAssistantDelayMs={0}
        showClearButton
      />,
    );

    await waitFor(() => expect(onMessagesChange).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'welcome', text: 'Welcome!' })],
      expect.objectContaining({ source: 'uncontrolled', reason: 'initial' }),
    ));

    await user.type(screen.getByPlaceholderText('Send a message'), 'observe me');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onMessagesChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ role: 'assistant', text: 'streamed reply' })]),
      expect.objectContaining({ source: 'uncontrolled', reason: 'assistant' }),
    ));

    await user.click(screen.getAllByTitle('Delete')[0]);
    await waitFor(() => expect(onMessagesChange).toHaveBeenCalledWith(
      expect.not.arrayContaining([expect.objectContaining({ id: 'welcome' })]),
      expect.objectContaining({ source: 'uncontrolled', reason: 'delete' }),
    ));

    await user.click(screen.getByRole('button', { name: /clear conversation/i }));
    await waitFor(() => expect(onMessagesChange).toHaveBeenLastCalledWith([], expect.objectContaining({ reason: 'clear' })));
  });

  it('observes controlled value updates without broadening onChange beyond controlled mode', async () => {
    const user = userEvent.setup();
    const onMessagesChange = vi.fn();
    const onChange = vi.fn<(messages: Message[]) => void>();

    function Harness() {
      const [messages, setMessages] = React.useState<Message[]>([{ id: 'seed', role: 'assistant', text: 'controlled seed' }]);
      return (
        <Chorus
          value={messages}
          onChange={(next) => {
            onChange(next);
            setMessages(next);
          }}
          onMessagesChange={onMessagesChange}
          onSend={() => ({ id: 'controlled-assistant', role: 'assistant', text: 'controlled reply' })}
          minAssistantDelayMs={0}
        />
      );
    }

    render(<Harness />);

    await waitFor(() => expect(onMessagesChange).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'seed' })],
      expect.objectContaining({ source: 'controlled' }),
    ));

    await user.type(screen.getByPlaceholderText('Send a message'), 'controlled send');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(screen.getByText('controlled reply')).toBeInTheDocument());
    expect(onChange).toHaveBeenCalled();
    expect(onMessagesChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'controlled-assistant', text: 'controlled reply' })]),
      expect.objectContaining({ source: 'controlled', reason: 'assistant' }),
    );
  });

  it('fills and focuses the composer when a suggested prompt is clicked', async () => {
    const user = userEvent.setup();

    render(<Chorus suggestedPrompts={['Plan a launch checklist', 'Write a test plan']} />);

    await user.click(screen.getByRole('button', { name: 'Plan a launch checklist' }));

    const composer = screen.getByRole('textbox', { name: /send a message/i });
    expect(composer).toHaveValue('Plan a launch checklist');
    await waitFor(() => expect(composer).toHaveFocus());
  });

  it.each([
    ['disabled', { disabled: true }],
    ['read-only', { readOnly: true }],
  ] as const)('blocks composer sends, suggested prompts, and imperative send while %s', async (label, modeProps) => {
    const user = userEvent.setup();
    const ref = React.createRef<ChorusRef>();
    const onSend = vi.fn<OnSend>(async () => undefined);

    render(
      <Chorus
        ref={ref}
        {...modeProps}
        disabledReason="Select a conversation first"
        suggestedPrompts={['Plan a launch checklist']}
        onSend={onSend}
      />,
    );

    const composer = screen.getByRole('textbox', { name: /send a message/i });
    const prompt = screen.getByRole('button', { name: 'Plan a launch checklist' });

    if (label === 'disabled') expect(composer).toBeDisabled();
    else expect(composer).toHaveAttribute('readonly');
    expect(composer).toHaveAttribute('placeholder', 'Select a conversation first');
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
    expect(prompt).toBeDisabled();

    await user.click(prompt);
    expect(composer).toHaveValue('');

    act(() => ref.current?.send('imperative send'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it.each([
    ['disabled', { disabled: true }],
    ['read-only', { readOnly: true }],
  ] as const)('hides write message actions and disables clear while %s', (_label, modeProps) => {
    render(
      <Chorus
        {...modeProps}
        onSend={vi.fn<OnSend>(async () => undefined)}
        messages={[
          { id: 'u1', role: 'user', text: 'Hello' },
          { id: 'a1', role: 'assistant', text: 'Hi' },
        ]}
        showClearButton
      />,
    );

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Regenerate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear conversation' })).toBeDisabled();
  });

  it('prefers custom emptyState over suggestedPrompts', () => {
    render(<Chorus emptyState={<div>Custom welcome</div>} suggestedPrompts={['Hidden prompt']} />);

    expect(screen.getByText('Custom welcome')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hidden prompt' })).not.toBeInTheDocument();
  });

  it('renders, observes, and persists initialMessages when persistence storage is empty', async () => {
    const storage = makeSyncStorage();
    const onMessagesChange = vi.fn();
    const welcome: Message[] = [{ id: 'welcome', role: 'assistant', text: 'Welcome!' }];

    render(<Chorus persistenceKey="chat" persistenceStorage={storage} initialMessages={welcome} onMessagesChange={onMessagesChange} />);

    expect(screen.getByText('Welcome!')).toBeInTheDocument();
    await waitFor(() => expect(storage.store.chat).toBe(JSON.stringify(welcome)));
    expect(onMessagesChange).toHaveBeenCalledWith(welcome, expect.objectContaining({
      source: 'persistence',
      reason: 'persistence-seed',
    }));
  });

  it('uses legacy messages as a persistence seed when storage is empty', async () => {
    const storage = makeSyncStorage();
    const welcome: Message[] = [{ id: 'welcome', role: 'assistant', text: 'Legacy welcome!' }];

    render(<Chorus persistenceKey="chat" persistenceStorage={storage} messages={welcome} />);

    expect(screen.getByText('Legacy welcome!')).toBeInTheDocument();
    await waitFor(() => expect(storage.store.chat).toBe(JSON.stringify(welcome)));
  });

  it('lets existing persisted history win over initialMessages', () => {
    const stored: Message[] = [{ id: 'stored', role: 'assistant', text: 'Stored history' }];
    const storage = makeSyncStorage({ chat: JSON.stringify(stored) });

    render(
      <Chorus
        persistenceKey="chat"
        persistenceStorage={storage}
        initialMessages={[{ id: 'welcome', role: 'assistant', text: 'Welcome!' }]}
      />
    );

    expect(screen.getByText('Stored history')).toBeInTheDocument();
    expect(screen.queryByText('Welcome!')).not.toBeInTheDocument();
  });

  it('observes persistence-backed loads and clears', async () => {
    const user = userEvent.setup();
    const stored: Message[] = [{ id: 'stored', role: 'assistant', text: 'Stored observed history' }];
    const storage = makeSyncStorage({ chat: JSON.stringify(stored) });
    const onMessagesChange = vi.fn();

    render(
      <Chorus
        persistenceKey="chat"
        persistenceStorage={storage}
        onMessagesChange={onMessagesChange}
        showClearButton
      />,
    );

    await waitFor(() => expect(onMessagesChange).toHaveBeenCalledWith(
      stored,
      expect.objectContaining({ source: 'persistence', reason: 'persistence-load' }),
    ));

    await user.click(screen.getByRole('button', { name: /clear conversation/i }));

    await waitFor(() => expect(onMessagesChange).toHaveBeenLastCalledWith([], expect.objectContaining({ source: 'persistence', reason: 'clear' })));
  });

  it('resets composer draft when persistenceKey switches conversations', async () => {
    const user = userEvent.setup();
    const storage = makeSyncStorage({
      'chat:a': JSON.stringify([{ id: 'a1', role: 'assistant', text: 'Conversation A' }]),
      'chat:b': JSON.stringify([{ id: 'b1', role: 'assistant', text: 'Conversation B' }]),
    });

    const { rerender } = render(<Chorus persistenceKey="chat:a" persistenceStorage={storage} />);

    const composer = screen.getByRole('textbox', { name: /send a message/i });
    await user.type(composer, 'unsent draft for A');
    expect(composer).toHaveValue('unsent draft for A');

    rerender(<Chorus persistenceKey="chat:b" persistenceStorage={storage} />);

    expect(screen.getByRole('textbox', { name: /send a message/i })).toHaveValue('');
  });

  it('waits for an empty async persistence load before rendering and saving the seed', async () => {
    const pendingRead = deferred<string | null>();
    const welcome: Message[] = [{ id: 'welcome', role: 'assistant', text: 'Async welcome!' }];
    const asyncStorage: StorageAdapter = {
      getItem: vi.fn(() => pendingRead.promise),
      setItem: vi.fn(),
    };

    render(<Chorus persistenceKey="chat" persistenceStorage={asyncStorage} initialMessages={welcome} />);

    expect(screen.queryByText('Async welcome!')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /send a message/i })).toBeDisabled();
    expect(screen.getByPlaceholderText('Loading saved conversation…')).toBeInTheDocument();
    expect(asyncStorage.setItem).not.toHaveBeenCalled();

    await act(async () => {
      pendingRead.resolve(null);
      await pendingRead.promise;
    });

    expect(screen.getByText('Async welcome!')).toBeInTheDocument();
    await waitFor(() => expect(asyncStorage.setItem).toHaveBeenCalledWith('chat', JSON.stringify(welcome)));
  });

  it('keeps the initialMessages seed hidden while async persistence loads stored history', async () => {
    const pendingRead = deferred<string | null>();
    const stored: Message[] = [{ id: 'stored', role: 'assistant', text: 'Async stored history' }];
    const asyncStorage: StorageAdapter = {
      getItem: vi.fn(() => pendingRead.promise),
      setItem: vi.fn(),
    };

    render(
      <Chorus
        persistenceKey="chat"
        persistenceStorage={asyncStorage}
        initialMessages={[{ id: 'welcome', role: 'assistant', text: 'Async welcome!' }]}
      />
    );

    expect(screen.queryByText('Async welcome!')).not.toBeInTheDocument();
    await act(async () => {
      pendingRead.resolve(JSON.stringify(stored));
      await pendingRead.promise;
    });

    expect(screen.getByText('Async stored history')).toBeInTheDocument();
    expect(screen.queryByText('Async welcome!')).not.toBeInTheDocument();
    expect(asyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('blocks sends while async persistence is still loading so stored transcripts are not clobbered', async () => {
    const ref = React.createRef<ChorusRef>();
    const pendingRead = deferred<string | null>();
    const stored: Message[] = [{ id: 'stored', role: 'assistant', text: 'Stored before send' }];
    const onSend = vi.fn<OnSend>(async () => ({ id: 'reply', role: 'assistant', text: 'reply' }));
    const asyncStorage: StorageAdapter = {
      getItem: vi.fn(() => pendingRead.promise),
      setItem: vi.fn(),
    };

    render(<Chorus ref={ref} persistenceKey="chat" persistenceStorage={asyncStorage} onSend={onSend} minAssistantDelayMs={0} />);

    expect(screen.getByRole('textbox', { name: /send a message/i })).toBeDisabled();
    act(() => ref.current?.send('pre-load send'));
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(onSend).not.toHaveBeenCalled();
    expect(asyncStorage.setItem).not.toHaveBeenCalled();
    expect(screen.queryByText('pre-load send')).not.toBeInTheDocument();

    await act(async () => {
      pendingRead.resolve(JSON.stringify(stored));
      await pendingRead.promise;
    });

    expect(screen.getByText('Stored before send')).toBeInTheDocument();
    expect(asyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('coalesces persistence writes during token streams and flushes the final assistant text', async () => {
    const user = userEvent.setup();
    const chunks = Array.from({ length: 100 }, () => 'x');
    const finalText = chunks.join('');
    const store: Record<string, string> = {};
    const storage: StorageAdapter = {
      getItem: vi.fn((key) => store[key] ?? null),
      setItem: vi.fn((key, value) => { store[key] = value; }),
    };
    const transport = vi.fn<Transport>(async () => sseResponse(chunks));

    render(<Chorus persistenceKey="chat" persistenceStorage={storage} transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'persist stream');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText(finalText)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    await waitFor(() => expect(storage.setItem).toHaveBeenCalled());

    const callsAfterFinal = vi.mocked(storage.setItem).mock.calls.length;
    expect(callsAfterFinal).toBeLessThanOrEqual(3);

    const lastWrite = vi.mocked(storage.setItem).mock.calls.at(-1);
    expect(lastWrite?.[0]).toBe('chat');
    const persistedMessages = JSON.parse(lastWrite?.[1] ?? '[]') as Message[];
    expect(persistedMessages).toEqual([
      expect.objectContaining({ role: 'user', text: 'persist stream' }),
      expect.objectContaining({ role: 'assistant', text: finalText }),
    ]);

    await new Promise(resolve => setTimeout(resolve, 120));
    expect(storage.setItem).toHaveBeenCalledTimes(callsAfterFinal);
  });

  it('surfaces persistence read failures through onPersistenceError', async () => {
    const onPersistenceError = vi.fn();
    const storage = makeSyncStorage({ chat: 'not json {{' });

    render(<Chorus persistenceKey="chat" persistenceStorage={storage} onPersistenceError={onPersistenceError} />);

    await waitFor(() => expect(onPersistenceError).toHaveBeenCalledWith(expect.objectContaining({
      key: 'chat',
      operation: 'deserialize',
    })));
    expect(screen.queryByRole('log')).toBeInTheDocument();
  });

  it('does not read ignored built-in persistence in controlled mode', async () => {
    const onPersistenceError = vi.fn();
    const storage: StorageAdapter = {
      getItem: vi.fn(() => { throw new Error('blocked storage'); }),
      setItem: vi.fn(),
    };

    render(
      <Chorus
        value={[{ id: 'controlled', role: 'assistant', text: 'Controlled transcript' }]}
        onChange={vi.fn()}
        persistenceKey="chat"
        persistenceStorage={storage}
        onPersistenceError={onPersistenceError}
      />,
    );

    expect(screen.getByText('Controlled transcript')).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(onPersistenceError).not.toHaveBeenCalled();
  });

  it('surfaces persistence write failures through onPersistenceError', async () => {
    const user = userEvent.setup();
    const quotaError = new DOMException('Full', 'QuotaExceededError');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onPersistenceError = vi.fn();
    const storage: StorageAdapter = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { throw quotaError; }),
    };

    render(<Chorus persistenceKey="chat" persistenceStorage={storage} onPersistenceError={onPersistenceError} onSend={() => undefined} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'will persist');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(screen.getByText('will persist')).toBeInTheDocument();
    await waitFor(() => expect(onPersistenceError).toHaveBeenCalledWith(quotaError));
    expect(warn).toHaveBeenCalledWith('[Chorus] Failed to persist messages.', quotaError);
    warn.mockRestore();
  });

  it('prepends systemPrompt to transport history without rendering it', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([]));

    render(<Chorus transport={transport} systemPrompt="Stay concise." minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'hi');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(transport).toHaveBeenCalledOnce());
    expect(transport.mock.calls[0][1]).toEqual([
      { id: 'chorus-system-prompt', role: 'system', text: 'Stay concise.' },
      expect.objectContaining({ role: 'user', text: 'hi' }),
    ]);
    expect(screen.queryByText('Stay concise.')).not.toBeInTheDocument();
  });

  it('exposes systemPrompt to onSend helpers without prepending it to messages', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn<OnSend>(async () => undefined);

    render(<Chorus onSend={onSend} systemPrompt="Stay concise." minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'hi');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    const [, messages, helpers] = onSend.mock.calls[0];
    expect(messages).toEqual([expect.objectContaining({ role: 'user', text: 'hi' })]);
    expect(messages.some(message => message.role === 'system')).toBe(false);
    expect(helpers.systemPrompt).toBe('Stay concise.');
    expect(screen.queryByText('Stay concise.')).not.toBeInTheDocument();
  });

  it('uses transport instead of onSend when both are provided', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const transport = vi.fn<Transport>(async () => sseResponse([]));
    const onSend = vi.fn<OnSend>(async () => undefined);

    render(<Chorus transport={transport} onSend={onSend} systemPrompt="Stay concise." minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'hi');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(transport).toHaveBeenCalledOnce());
    expect(onSend).not.toHaveBeenCalled();
    expect(transport.mock.calls[0][1][0]).toEqual({ id: 'chorus-system-prompt', role: 'system', text: 'Stay concise.' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`transport` takes precedence'));
    warn.mockRestore();
  });

  it('warns in development when an update produces duplicate message IDs', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onSend = vi.fn<NonNullable<ChorusProps['onSend']>>(async () => undefined);

    render(<Chorus messages={[
      { id: 'dup', role: 'assistant', text: 'one' },
      { id: 'dup', role: 'assistant', text: 'two' },
    ]} onSend={onSend} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(warn).toHaveBeenCalledWith('[Chorus] Duplicate message IDs detected:', ['dup']));
    warn.mockRestore();
  });

  it('generates unique message IDs for rapid sends in the same millisecond', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let latestMessages: Message[] = [];

    function Harness() {
      const [messages, setMessages] = React.useState<Message[]>([]);
      return (
        <Chorus
          value={messages}
          onChange={(next) => {
            latestMessages = next;
            setMessages(next);
          }}
          onSend={() => ({ role: 'assistant', text: 'ok' } as Message)}
          minAssistantDelayMs={0}
        />
      );
    }

    render(<Harness />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'one');
    const firstNow = vi.spyOn(Date, 'now').mockReturnValue(12345);
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(latestMessages).toHaveLength(2));
    firstNow.mockRestore();

    await user.type(screen.getByPlaceholderText('Send a message'), 'two');
    const secondNow = vi.spyOn(Date, 'now').mockReturnValue(12345);
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(latestMessages).toHaveLength(4));
    secondNow.mockRestore();

    const ids = latestMessages.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns when messages is paired with onChange instead of value', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(<Chorus messages={[]} onChange={vi.fn()} />);

    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('`messages` is initial-only')));
    warn.mockRestore();
  });

  it('warns when value and persistenceKey are both provided', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(<Chorus value={[]} persistenceKey="chat" />);

    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('Both `value` and `persistenceKey`')));
    warn.mockRestore();
  });

  it('warns once at send time when neither transport nor onSend is provided without mutating the transcript', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(<Chorus />);

    const textbox = screen.getByPlaceholderText('Send a message');
    await user.type(textbox, 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('`transport` nor `onSend`')));
    expect(warn.mock.calls.filter(call => String(call[0]).includes('`transport` nor `onSend`'))).toHaveLength(1);
    expect(screen.getByRole('log')).not.toHaveTextContent('hello');
    expect(textbox).toHaveValue('hello');
    warn.mockRestore();
  });

  it('warns when sending is provided with a transport', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(<Chorus transport={async () => sseResponse([])} sending={false} />);

    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('`sending` was provided alongside `transport`')));
    warn.mockRestore();
  });

  it('onSend can return a message for a non-streaming assistant response', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn<OnSend>(async () => ({
      id: 'assistant-1',
      role: 'assistant',
      text: 'non-streamed reply',
      metadata: { source: 'rest' },
    }));

    render(<Chorus onSend={onSend} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(await screen.findByText('non-streamed reply')).toBeInTheDocument();
  });

  it('calls onFinish for completed transport streams with the final assistant message', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse(['Hel', 'lo']));
    const onFinish = vi.fn();

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} onFinish={onFinish} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'finish transport');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onFinish).toHaveBeenCalledOnce());
    expect(onFinish.mock.calls[0][0]).toEqual(expect.objectContaining({
      reason: 'done',
      message: expect.objectContaining({ role: 'assistant', text: 'Hello' }),
      response: expect.any(Response),
    }));
    expect(onFinish.mock.calls[0][0].messages.at(-1)).toEqual(expect.objectContaining({ text: 'Hello' }));
  });

  it('calls onFinish for helper streams, auto-finalized helper streams, and returned messages', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onFinish = vi.fn();
    const onSend = vi.fn<OnSend>(async (text, _messages, helpers) => {
      if (text === 'stream') {
        helpers.appendAssistant('helper done');
        helpers.finalizeAssistant();
        return;
      }
      if (text === 'auto') {
        helpers.appendAssistant('auto done');
        return;
      }
      return { id: 'returned', role: 'assistant', text: 'returned done' };
    });

    render(<Chorus onSend={onSend} minAssistantDelayMs={0} onFinish={onFinish} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'stream');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
    expect(onFinish.mock.calls[0][0]).toEqual(expect.objectContaining({ reason: 'done', message: expect.objectContaining({ text: 'helper done' }) }));

    await user.type(screen.getByPlaceholderText('Send a message'), 'auto');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(2));
    expect(onFinish.mock.calls[1][0]).toEqual(expect.objectContaining({ reason: 'done', message: expect.objectContaining({ text: 'auto done' }) }));

    await user.type(screen.getByPlaceholderText('Send a message'), 'return');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(3));
    expect(onFinish.mock.calls[2][0]).toEqual(expect.objectContaining({ reason: 'returned-message', message: expect.objectContaining({ text: 'returned done' }) }));
    warn.mockRestore();
  });

  it('does not call onFinish on aborts, errors, or sends with no assistant output', async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    let helpers!: OnSendHelpers;
    const onSend = vi.fn<OnSend>((text, _messages, h) => {
      helpers = h;
      if (text === 'error') throw new Error('boom');
      if (text === 'empty') return undefined;
      h.appendAssistant('partial');
      return new Promise<void>((_resolve, reject) => {
        h.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });

    render(<Chorus onSend={onSend} minAssistantDelayMs={0} onFinish={onFinish} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'stop');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /stop/i }));
    await waitFor(() => expect(helpers.signal.aborted).toBe(true));

    await user.type(screen.getByPlaceholderText('Send a message'), 'error');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByText('Something went wrong. Please try again.');

    await user.type(screen.getByPlaceholderText('Send a message'), 'empty');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('empty', expect.any(Array), expect.any(Object)));

    expect(onFinish).not.toHaveBeenCalled();
  });

  it('calls onAbort with the partial assistant when Stop cancels streamed onSend output', async () => {
    const user = userEvent.setup();
    const onAbort = vi.fn();
    let capturedSignal: AbortSignal | undefined;
    const onSend = vi.fn<OnSend>((_text, _messages, helpers) => {
      capturedSignal = helpers.signal;
      helpers.appendAssistant('partial abort');
      return new Promise<void>((_resolve, reject) => {
        helpers.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });

    render(<Chorus onSend={onSend} minAssistantDelayMs={0} onAbort={onAbort} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'stop after token');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(await screen.findByText('partial abort')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /stop/i }));

    await waitFor(() => expect(onAbort).toHaveBeenCalledOnce());
    expect(capturedSignal?.aborted).toBe(true);
    expect(onAbort.mock.calls[0][0]).toEqual(expect.objectContaining({
      reason: 'stop',
      source: 'user',
      path: 'onSend',
      message: expect.objectContaining({ role: 'assistant', text: 'partial abort' }),
    }));
    expect(onAbort.mock.calls[0][0].messages).toEqual([
      expect.objectContaining({ role: 'user', text: 'stop after token' }),
      expect.objectContaining({ role: 'assistant', text: 'partial abort' }),
    ]);
  });

  it('calls onAbort with a null assistant when Stop happens before the first transport token', async () => {
    const user = userEvent.setup();
    const onAbort = vi.fn();
    let capturedSignal: AbortSignal | undefined;
    const transport = vi.fn<Transport>((_text, _history, signal) => {
      capturedSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        }, { once: true });
      });
    });

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} onAbort={onAbort} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'stop before token');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /stop/i }));

    await waitFor(() => expect(onAbort).toHaveBeenCalledOnce());
    expect(capturedSignal?.aborted).toBe(true);
    expect(onAbort.mock.calls[0][0]).toEqual(expect.objectContaining({
      reason: 'stop',
      source: 'user',
      path: 'transport',
      message: null,
    }));
    expect(onAbort.mock.calls[0][0].messages).toEqual([
      expect.objectContaining({ role: 'user', text: 'stop before token' }),
    ]);
  });

  it('onSend path calls onSend with text, messages, and helpers', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [{ id: 'm1', role: 'assistant', text: 'Welcome' }];
    const onSend = vi.fn<OnSend>(async () => undefined);

    render(<Chorus messages={initial} onSend={onSend} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    const [text, messages, helpers] = onSend.mock.calls[0];
    expect(text).toBe('hello');
    expect(messages).toEqual([
      initial[0],
      expect.objectContaining({ role: 'user', text: 'hello' }),
    ]);
    expect(helpers).toEqual(expect.objectContaining({
      appendAssistant: expect.any(Function),
      finalizeAssistant: expect.any(Function),
      signal: expect.any(AbortSignal),
    }));
  });

  it('adds the user message before the assistant response arrives', async () => {
    const user = userEvent.setup();
    const pending = deferred<void>();
    const onSend = vi.fn(() => pending.promise);

    render(<Chorus onSend={onSend} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'waiting prompt');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(screen.getByText('waiting prompt')).toBeInTheDocument();
    expect(screen.queryByText('late response')).not.toBeInTheDocument();

    pending.resolve();
  });

  it('finalizeAssistant ends the stream and sets sending=false', async () => {
    const user = userEvent.setup();
    let helpers!: OnSendHelpers;
    const onSend = vi.fn((_text: string, _messages: Message[], h: OnSendHelpers) => {
      helpers = h;
      return new Promise<void>(() => undefined);
    });

    render(<Chorus onSend={onSend} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'stream');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());

    act(() => helpers.appendAssistant('partial'));
    expect(await screen.findByText('partial')).toBeInTheDocument();

    act(() => helpers.finalizeAssistant());
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
  });

  it('auto-finalizes helper chunks when onSend resolves without finalizeAssistant', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onSend = vi.fn<OnSend>(async (_text, _messages, helpers) => {
      helpers.appendAssistant('forgotten finalize');
    });

    render(<Chorus onSend={onSend} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'stream');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('forgotten finalize')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('resolved without calling `helpers.finalizeAssistant()`'));
    warn.mockRestore();
  });

  it('auto-finalizes helper chunks without a process global', async () => {
    const user = userEvent.setup();
    const originalProcess = globalThis.process;
    const processWithoutEnv = Object.create(originalProcess ?? null) as typeof process;
    Object.defineProperty(processWithoutEnv, 'env', { value: undefined, configurable: true, writable: true });
    const onSend = vi.fn<OnSend>(async (_text, _messages, helpers) => {
      helpers.appendAssistant('browser finalize');
    });

    Object.defineProperty(globalThis, 'process', { value: processWithoutEnv, configurable: true, writable: true });
    try {
      render(<Chorus onSend={onSend} minAssistantDelayMs={0} />);

      await user.type(screen.getByPlaceholderText('Send a message'), 'stream');
      await user.click(screen.getByRole('button', { name: /send/i }));

      expect(await screen.findByText('browser finalize')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
      expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(globalThis, 'process', { value: originalProcess, configurable: true, writable: true });
    }
  });

  it('shows an error banner when the transport path fails', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([], 500));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'boom');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('transport path passes the raw error to onError while keeping the UI banner generic', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([], 500));
    const onError = vi.fn();

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} onError={onError} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'boom');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toMatch(/HTTP 500/i);
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/HTTP 500/i)).not.toBeInTheDocument();
  });

  it('transport path surfaces in-band error payloads through onError and the UI banner', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ delta: { content: 'partial' } }] }),
      JSON.stringify({ error: 'stream failed' }),
    ]));
    const onError = vi.fn();

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} onError={onError} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'boom');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe('stream failed');
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('passes Gemini safety finish reasons to onError while keeping the UI banner generic', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }),
    ]));
    const onError = vi.fn();

    render(<Chorus transport={transport} connector="gemini" minAssistantDelayMs={0} onError={onError} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'blocked');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][0].message).toContain('finishReason: SAFETY');
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/finishReason: SAFETY/)).not.toBeInTheDocument();
  });

  it('renders reasoning and tool deltas from the useChorusStream onSend bridge', async () => {
    const user = userEvent.setup();
    const bridgeTransport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: 'bridge plan' } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: { content: 'bridge answer' } }] }),
      '[DONE]',
    ]));

    function Bridge() {
      const { send } = useChorusStream(bridgeTransport, { connector: 'openai' });
      return (
        <Chorus
          minAssistantDelayMs={0}
          onSend={(text, messages, helpers) => send(text, messages, helpers.streamCallbacks?.() ?? {
            onChunk: helpers.appendAssistant,
            onReasoning: helpers.appendReasoning,
            onToolDelta: helpers.appendToolDelta,
            onDone: helpers.finalizeAssistant,
          }, helpers.signal)}
        />
      );
    }

    render(<Bridge />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'bridge reasoning');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('bridge answer')).toBeInTheDocument();
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
    expect(screen.getByText('bridge plan')).toBeInTheDocument();
  });

  it('renders a tool-only stream from the useChorusStream onSend bridge', async () => {
    const user = userEvent.setup();
    const bridgeTransport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":"bridge"}' } }] } }] }),
      '[DONE]',
    ]));

    function Bridge() {
      const { send } = useChorusStream(bridgeTransport, { connector: 'openai' });
      return <Chorus minAssistantDelayMs={0} onSend={(text, messages, helpers) => send(text, messages, helpers.streamCallbacks?.() ?? { onChunk: helpers.appendAssistant, onDone: helpers.finalizeAssistant }, helpers.signal)} />;
    }

    render(<Bridge />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'bridge tool');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('button', { name: /search/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(screen.queryByRole('status', { name: /assistant is typing/i })).not.toBeInTheDocument();
  });

  it('renders a bridged tool call followed by final assistant text', async () => {
    const user = userEvent.setup();
    const bridgeTransport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":"bridge"}' } }] } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: { content: 'bridge final' } }] }),
      '[DONE]',
    ]));

    function Bridge() {
      const { send } = useChorusStream(bridgeTransport, { connector: 'openai' });
      return <Chorus minAssistantDelayMs={0} onSend={(text, messages, helpers) => send(text, messages, helpers.streamCallbacks?.() ?? { onChunk: helpers.appendAssistant, onDone: helpers.finalizeAssistant }, helpers.signal)} />;
    }

    render(<Bridge />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'bridge both');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('button', { name: /search/i })).toBeInTheDocument();
    expect(await screen.findByText('bridge final')).toBeInTheDocument();
  });

  it('surfaces errors from the documented useChorusStream onSend bridge', async () => {
    const user = userEvent.setup();
    const bridgeTransport = vi.fn<Transport>(async () => new Response('bad gateway', { status: 502, statusText: 'Bad Gateway' }));
    const onError = vi.fn();

    function Bridge() {
      const { send } = useChorusStream(bridgeTransport);
      return (
        <Chorus
          minAssistantDelayMs={0}
          onError={onError}
          onSend={(text, messages, helpers) => send(text, messages, {
            onChunk: helpers.appendAssistant,
            onDone: helpers.finalizeAssistant,
          }, helpers.signal)}
        />
      );
    }

    render(<Bridge />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'boom');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][0].message).toContain('HTTP 502 Bad Gateway: bad gateway');
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('ignores throwing onChunk observers on the transport path', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onChunk = vi.fn(() => { throw new Error('analytics failed'); });
    const transport = vi.fn<Transport>(async () => sseResponse(['safe']));

    render(<Chorus transport={transport} onChunk={onChunk} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('safe')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`onChunk` callback threw'), expect.any(Error));
    warn.mockRestore();
  });

  it('ignores throwing onChunk observers on the onSend helper path', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onChunk = vi.fn(() => { throw new Error('analytics failed'); });
    const onSend = vi.fn<OnSend>(async (_text, _messages, helpers) => {
      helpers.appendAssistant('helper safe');
      helpers.finalizeAssistant();
    });

    render(<Chorus onSend={onSend} onChunk={onChunk} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('helper safe')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`onChunk` callback threw'), expect.any(Error));
    warn.mockRestore();
  });

  it('onSend non-abort error invokes onError with the Error object', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    const onSend = vi.fn(async () => {
      throw new Error('upstream boom');
    });

    render(<Chorus onSend={onSend} onError={onError} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'trigger error');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    const passed = onError.mock.calls[0][0];
    expect(passed).toBeInstanceOf(Error);
    expect(passed.message).toBe('upstream boom');
  });

  it('onSend non-abort error without an onError prop falls back to the UI banner', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(async () => {
      throw new Error('upstream boom');
    });

    render(<Chorus onSend={onSend} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'trigger error');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/upstream boom/i)).not.toBeInTheDocument();
  });

  it('custom renderError receives error context and dismiss clears the banner without retrying', async () => {
    const user = userEvent.setup();
    const rawError = new Error('upstream boom');
    const onSend = vi.fn(async () => {
      throw rawError;
    });
    const renderError = vi.fn(({ error, rawError, dismiss }) => (
      <div role="alert">
        <span>{error}</span>
        <span>{rawError?.message}</span>
        <button type="button" onClick={dismiss}>Dismiss problem</button>
      </div>
    ));

    render(<Chorus onSend={onSend} renderError={renderError} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'trigger error');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
    expect(screen.getByRole('alert')).toHaveTextContent('upstream boom');
    expect(renderError).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Something went wrong. Please try again.',
      rawError,
      retry: expect.any(Function),
      dismiss: expect.any(Function),
    }));

    await user.click(screen.getByRole('button', { name: /dismiss problem/i }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('onSend abort (user stop) does not invoke onError and shows no banner', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    let capturedSignal: AbortSignal | undefined;
    const onSend = vi.fn((_text: string, _messages: Message[], helpers: OnSendHelpers) => {
      capturedSignal = helpers.signal;
      return new Promise<void>((_resolve, reject) => {
        helpers.signal.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    render(<Chorus onSend={onSend} onError={onError} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'stop me');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /stop/i }));

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true));
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(onError).not.toHaveBeenCalled();
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
  });

  it('ignores captured onSend helpers after Stop', async () => {
    const user = userEvent.setup();
    let helpers!: OnSendHelpers;
    const onSend = vi.fn((_text: string, _messages: Message[], h: OnSendHelpers) => {
      helpers = h;
      return new Promise<void>(() => undefined);
    });

    render(<Chorus onSend={onSend} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'stop stale helpers');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /stop/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());

    act(() => {
      helpers.appendAssistant('late chunk');
      helpers.finalizeAssistant();
    });

    expect(screen.queryByText('late chunk')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  it('controlled mode forwards new messages via onChange and renders the externally-controlled list', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [{ id: 'seed', role: 'assistant', text: 'seeded reply' }];
    const onChange = vi.fn<(next: Message[]) => void>();
    const onSend = vi.fn(async () => undefined);

    render(<Chorus value={initial} onChange={onChange} onSend={onSend} minAssistantDelayMs={0} />);

    // The externally-controlled list is rendered as-is.
    expect(screen.getByText('seeded reply')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Send a message'), 'hello there');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const latestCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(latestCall).toEqual(
      expect.arrayContaining([
        initial[0],
        expect.objectContaining({ role: 'user', text: 'hello there' }),
      ]),
    );
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('Retry re-triggers the assistant with the last user text', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([], 500));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'try again');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByRole('button', { name: /retry/i });

    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    expect(transport.mock.calls[0][0]).toBe('try again');
    expect(transport.mock.calls[1][0]).toBe('try again');
  });

  it('Retry resubmits an image-only message with its attachment', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([], 500));
    const file = new File(['image-bytes'], 'photo.png', { type: 'image/png' });
    const { container } = render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} accept="image/*" />);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await screen.findByText('photo.png');

    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByRole('button', { name: /retry/i });

    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    expect(transport.mock.calls[1][0]).toBe('');
    expect(transport.mock.calls[1][1]).toEqual([
      expect.objectContaining({
        role: 'user',
        text: '',
        attachments: [expect.objectContaining({
          name: 'photo.png',
          type: 'image/png',
          size: file.size,
          data: expect.stringMatching(/^data:image\/png;base64,/),
        })],
      }),
    ]);
  });

  it('Retry preserves a text-and-attachment turn without duplicating it', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => (
      transport.mock.calls.length === 1
        ? sseResponse([], 500)
        : sseResponse(['ok'])
    ));
    const file = new File(['image-bytes'], 'photo.png', { type: 'image/png' });
    const { container } = render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} accept="image/*" />);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await screen.findByText('photo.png');
    await user.type(screen.getByPlaceholderText('Send a message'), 'describe this');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByRole('button', { name: /retry/i });

    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    const retryHistory = transport.mock.calls[1][1];
    const userTurns = retryHistory.filter(message => message.role === 'user');
    expect(userTurns).toHaveLength(1);
    expect(userTurns[0]).toEqual(expect.objectContaining({
      role: 'user',
      text: 'describe this',
      attachments: [expect.objectContaining({
        name: 'photo.png',
        type: 'image/png',
        size: file.size,
        data: expect.stringMatching(/^data:image\/png;base64,/),
      })],
    }));
    expect(screen.getAllByText('describe this')).toHaveLength(1);
    await waitFor(() => expect(screen.getAllByAltText('photo.png')).toHaveLength(1));
  });

  it('removes a failed partial transport response before retrying', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => (
      transport.mock.calls.length === 1
        ? erroringSSEResponse(['partial answer'])
        : sseResponse(['fresh answer'])
    ));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'try again');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('partial answer')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText('fresh answer')).toHaveLength(1));
    expect(transport.mock.calls[1][1]).toEqual([
      expect.objectContaining({ role: 'user', text: 'try again' }),
    ]);
    expect(transport.mock.calls[1][1]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ text: 'partial answer' })]),
    );
  });

  it('blocks built-in sends during an active transport request even when sending is visually overridden false', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const transport = vi.fn<Transport>(() => new Promise<Response>(() => undefined));
    const file = new File(['image-bytes'], 'blocked.png', { type: 'image/png' });

    const { container } = render(<Chorus transport={transport} sending={false} minAssistantDelayMs={0} accept="image/*" />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'first');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await screen.findByText('blocked.png');
    await user.type(screen.getByPlaceholderText('Send a message'), 'second');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(transport).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('first')).toHaveLength(1);
    expect(screen.getByRole('log')).not.toHaveTextContent('second');
    expect(screen.getByText('blocked.png')).toBeInTheDocument();
    warn.mockRestore();
  });

  it('Stop button aborts the active transport stream', async () => {
    const user = userEvent.setup();
    let capturedSignal: AbortSignal | undefined;
    const transport = vi.fn((_text: string, _history: Message[], signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'stop me');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /stop/i }));

    expect(capturedSignal?.aborted).toBe(true);
  });

  it('handleEdit truncates the message list at the edited index and re-triggers', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [
      { id: 'u1', role: 'user', text: 'original' },
      { id: 'a1', role: 'assistant', text: 'first answer' },
      { id: 'u2', role: 'user', text: 'follow up' },
      { id: 'a2', role: 'assistant', text: 'second answer' },
    ];
    const onSend = vi.fn(() => new Promise<void>(() => undefined));

    render(<Chorus messages={initial} onSend={onSend} />);

    await user.click(screen.getAllByTitle('Edit')[0]);
    const editBox = screen.getByDisplayValue('original');
    await user.clear(editBox);
    await user.type(editBox, 'edited');
    await user.click(screen.getByTitle('Save'));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith(
      'edited',
      expect.any(Array),
      expect.any(Object),
    ));
    expect(screen.getByText('edited')).toBeInTheDocument();
    expect(screen.queryByText('first answer')).not.toBeInTheDocument();
    expect(screen.queryByText('follow up')).not.toBeInTheDocument();
    expect(screen.queryByText('second answer')).not.toBeInTheDocument();
  });

  it('handleRegenerate removes the assistant message and re-triggers with the preceding user text', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [
      { id: 'u1', role: 'user', text: 'question' },
      { id: 'a1', role: 'assistant', text: 'old answer' },
    ];
    const onSend = vi.fn(() => new Promise<void>(() => undefined));

    render(<Chorus messages={initial} onSend={onSend} />);

    await user.click(screen.getByTitle('Regenerate'));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith(
      'question',
      expect.any(Array),
      expect.any(Object),
    ));
    expect(screen.getByText('question')).toBeInTheDocument();
    expect(screen.queryByText('old answer')).not.toBeInTheDocument();
  });

  it('handleDelete removes the message from the list', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [
      { id: 'u1', role: 'user', text: 'remove me' },
      { id: 'a1', role: 'assistant', text: 'keep me' },
    ];

    render(<Chorus messages={initial} />);

    await user.click(screen.getAllByTitle('Delete')[0]);

    expect(screen.queryByText('remove me')).not.toBeInTheDocument();
    expect(screen.getByText('keep me')).toBeInTheDocument();
  });

  it('cancels message delete when confirmDeleteMessage returns false without flushing persistence', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [
      { id: 'u1', role: 'user', text: 'keep me safe' },
      { id: 'a1', role: 'assistant', text: 'also keep me' },
    ];
    const storage = makeSyncStorage({ chat: JSON.stringify(initial) });
    const setItem = vi.fn(storage.setItem);
    storage.setItem = setItem;
    const confirmDeleteMessage = vi.fn(() => false);

    render(<Chorus persistenceKey="chat" persistenceStorage={storage} confirmDeleteMessage={confirmDeleteMessage} />);

    expect(await screen.findByText('keep me safe')).toBeInTheDocument();
    await user.click(screen.getAllByTitle('Delete')[0]);

    expect(confirmDeleteMessage).toHaveBeenCalledWith({
      message: expect.objectContaining({ id: 'u1', text: 'keep me safe' }),
      messages: initial,
    });
    expect(screen.getByText('keep me safe')).toBeInTheDocument();
    expect(screen.getByText('also keep me')).toBeInTheDocument();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('clears uncontrolled messages from the built-in clear button', async () => {
    const user = userEvent.setup();

    render(
      <Chorus
        messages={[{ id: 'welcome', role: 'assistant', text: 'clear me' }]}
        showClearButton
      />
    );

    expect(screen.getByText('clear me')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear conversation/i }));

    expect(screen.queryByText('clear me')).not.toBeInTheDocument();
  });

  it('can reset to the initialMessages seed when requested', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn<OnSend>(async () => ({ id: 'a1', role: 'assistant', text: 'reply' }));

    render(
      <Chorus
        initialMessages={[{ id: 'welcome', role: 'assistant', text: 'welcome back' }]}
        onSend={onSend}
        minAssistantDelayMs={0}
        showClearButton
        resetToInitialMessages
      />
    );

    await user.type(screen.getByPlaceholderText('Send a message'), 'question');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(await screen.findByText('reply')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear conversation/i }));

    expect(screen.getByText('welcome back')).toBeInTheDocument();
    expect(screen.queryByText('question')).not.toBeInTheDocument();
    expect(screen.queryByText('reply')).not.toBeInTheDocument();
  });

  it('persists the seed when resetToInitialMessages clears a persisted chat', async () => {
    const user = userEvent.setup();
    const storage = makeSyncStorage();
    storage.removeItem = vi.fn((key) => { delete storage.store[key]; });
    const welcome: Message[] = [{ id: 'welcome', role: 'assistant', text: 'persistent reset welcome' }];

    render(
      <Chorus
        persistenceKey="chat"
        persistenceStorage={storage}
        initialMessages={welcome}
        showClearButton
        resetToInitialMessages
      />,
    );

    await waitFor(() => expect(storage.store.chat).toBe(JSON.stringify(welcome)));
    await user.click(screen.getByRole('button', { name: /clear conversation/i }));

    expect(screen.getByText('persistent reset welcome')).toBeInTheDocument();
    await waitFor(() => expect(storage.store.chat).toBe(JSON.stringify(welcome)));
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('controlled clear calls onChange with the reset list', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(messages: Message[]) => void>();
    const onClear = vi.fn<(messages: Message[]) => void>();

    function Harness() {
      const [messages, setMessages] = React.useState<Message[]>([{ id: 'm1', role: 'assistant', text: 'controlled message' }]);
      return (
        <Chorus
          value={messages}
          onChange={(next) => {
            onChange(next);
            setMessages(next);
          }}
          onClear={onClear}
          showClearButton
        />
      );
    }

    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /clear conversation/i }));

    expect(onChange).toHaveBeenCalledWith([]);
    expect(onClear).toHaveBeenCalledWith([]);
    expect(screen.queryByText('controlled message')).not.toBeInTheDocument();
  });

  it('persists [] when clearing a seeded persisted chat with a removeItem-capable adapter', async () => {
    const user = userEvent.setup();
    const storage = makeSyncStorage();
    storage.removeItem = vi.fn((key) => { delete storage.store[key]; });
    const welcome: Message[] = [{ id: 'welcome', role: 'assistant', text: 'persistent welcome' }];
    const { unmount } = render(
      <Chorus
        persistenceKey="chat"
        persistenceStorage={storage}
        initialMessages={welcome}
        showClearButton
      />
    );

    await waitFor(() => expect(storage.store.chat).toBe(JSON.stringify(welcome)));
    await user.click(screen.getByRole('button', { name: /clear conversation/i }));

    await waitFor(() => expect(storage.store.chat).toBe(JSON.stringify([])));
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(screen.queryByText('persistent welcome')).not.toBeInTheDocument();

    unmount();
    render(
      <Chorus
        persistenceKey="chat"
        persistenceStorage={storage}
        initialMessages={welcome}
        showClearButton
      />
    );

    expect(screen.queryByText('persistent welcome')).not.toBeInTheDocument();
  });

  it('passes custom persistence serializer and deserializer hooks through Chorus', async () => {
    const user = userEvent.setup();
    const storage = makeSyncStorage({ chat: 'custom:read' });
    const serializeMessages = vi.fn(() => 'custom:write');
    const deserializeMessages = vi.fn(() => [{ id: 'stored', role: 'assistant', text: 'Stored custom' } as Message]);

    render(
      <Chorus
        persistenceKey="chat"
        persistenceStorage={storage}
        serializeMessages={serializeMessages}
        deserializeMessages={deserializeMessages}
        initialMessages={[{ id: 'welcome', role: 'assistant', text: 'Welcome!' }]}
        onSend={() => undefined}
      />
    );

    expect(screen.getByText('Stored custom')).toBeInTheDocument();
    expect(deserializeMessages).toHaveBeenCalledWith('custom:read');

    await user.type(screen.getByPlaceholderText('Send a message'), 'new message');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(serializeMessages).toHaveBeenCalled());
    await waitFor(() => expect(storage.store.chat).toBe('custom:write'));
  });

  it('persists cleared conversations so initialMessages do not resurrect on reload when removeItem is unavailable', async () => {
    const user = userEvent.setup();
    const storage = makeSyncStorage();
    const welcome: Message[] = [{ id: 'welcome', role: 'assistant', text: 'persistent welcome' }];
    const { unmount } = render(
      <Chorus
        persistenceKey="chat"
        persistenceStorage={storage}
        initialMessages={welcome}
        showClearButton
      />
    );

    expect(screen.getByText('persistent welcome')).toBeInTheDocument();
    await waitFor(() => expect(storage.store.chat).toBe(JSON.stringify(welcome)));

    await user.click(screen.getByRole('button', { name: /clear conversation/i }));
    await waitFor(() => expect(storage.store.chat).toBe(JSON.stringify([])));
    expect(screen.queryByText('persistent welcome')).not.toBeInTheDocument();

    unmount();
    render(
      <Chorus
        persistenceKey="chat"
        persistenceStorage={storage}
        initialMessages={welcome}
        showClearButton
      />
    );

    expect(screen.queryByText('persistent welcome')).not.toBeInTheDocument();
  });
});
