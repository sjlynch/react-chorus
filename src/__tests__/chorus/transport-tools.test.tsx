import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import { defineTool, toAnthropicMessagesBody, toOpenAIChatCompletionsBody } from '../../providerRequests';
import { sseResponse } from './testUtils';
import type { ChorusRef, OnSend, Transport } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus', () => {
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

  it('threads connectorOptions through the transport path so a custom reasoning tag is split out', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { content: '<reasoning>plan first</reasoning>final answer' } }] }),
      '[DONE]',
    ]));

    render(
      <Chorus
        transport={transport}
        connector="openai"
        connectorOptions={{ thinkTag: { start: '<reasoning>', end: '</reasoning>' } }}
        minAssistantDelayMs={0}
      />,
    );

    await user.type(screen.getByPlaceholderText('Send a message'), 'why');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('final answer')).toBeInTheDocument();
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
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
    expect(screen.queryByText(/assistant is typing/i)).not.toBeInTheDocument();
    expect(onFinish).not.toHaveBeenCalled();
    expect(onStreamDone).toHaveBeenCalledWith(expect.objectContaining({
      assistantMessage: null,
      toolMessages: [expect.objectContaining({ role: 'tool', toolCall: expect.objectContaining({ id: 'call_1', name: 'search', input: { q: 'test' } }) })],
      response: expect.any(Response),
    }));
  });

  it('routes a non-fatal connector warning to onStreamWarning while the stream still completes', async () => {
    const user = userEvent.setup();
    const onStreamWarning = vi.fn();
    const onFinish = vi.fn();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'cut off here' }] } }] }),
    ]));

    render(
      <Chorus
        transport={transport}
        connector="gemini"
        minAssistantDelayMs={0}
        onStreamWarning={onStreamWarning}
        onFinish={onFinish}
      />,
    );

    await user.type(screen.getByPlaceholderText('Send a message'), 'long answer');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('cut off here')).toBeInTheDocument();
    await waitFor(() => expect(onStreamWarning).toHaveBeenCalledTimes(1));
    expect(onStreamWarning).toHaveBeenCalledWith(expect.objectContaining({ code: 'truncated' }));
    expect(onFinish).toHaveBeenCalled();
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
    expect(screen.queryByText(/assistant is typing/i)).not.toBeInTheDocument();
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

  it('routes a streamed tool call to the matching defineTool entry in a tools array', async () => {
    const user = userEvent.setup();
    const handler = vi.fn(async () => ({ results: ['from array'] }));
    const searchTool = defineTool({
      name: 'search',
      description: 'Search the docs',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
      handler,
    });
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_arr', function: { name: 'search', arguments: '{"q":"chorus"}' } }] } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: { content: 'done' } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} tools={[searchTool]} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'go');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(handler).toHaveBeenCalledWith({ q: 'chorus' }, expect.objectContaining({ id: 'call_arr', name: 'search' })));
    expect(await screen.findByText('done')).toBeInTheDocument();
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

  it('continues the auto tool loop after a handler throws when continueOnToolError is set', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    const onStreamDone = vi.fn();
    const search = vi.fn(async () => {
      if (search.mock.calls.length === 1) throw new Error('tool failed');
      return { result: 'found' };
    });
    const transport = vi.fn<Transport>(async () => {
      const call = transport.mock.calls.length;
      if (call === 1) {
        return sseResponse([
          JSON.stringify({ choices: [{ index: 0, delta: { content: 'Let me search.', tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":"react"}' } }] } }] }),
          '[DONE]',
        ]);
      }
      if (call === 2) {
        return sseResponse([
          JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_2', function: { name: 'search', arguments: '{"q":"react"}' } }] } }] }),
          '[DONE]',
        ]);
      }
      return sseResponse([
        JSON.stringify({ choices: [{ index: 0, delta: { content: 'All good now.' } }] }),
        '[DONE]',
      ]);
    });

    render(<Chorus
      transport={transport}
      connector="openai"
      minAssistantDelayMs={0}
      autoContinueTools
      continueOnToolError
      tools={{ search }}
      onError={onError}
      onStreamDone={onStreamDone}
    />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'search react');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('All good now.')).toBeInTheDocument();
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(3));
    expect(search).toHaveBeenCalledTimes(2);
    // The throw is fed back to the model, not surfaced as a terminal turn error.
    expect(onError).not.toHaveBeenCalled();
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
    // Assistant text streamed in the failing iteration is kept, not discarded.
    expect(screen.getByText('Let me search.')).toBeInTheDocument();
    // The loop continued past the throw rather than ending the turn.
    expect(onStreamDone).toHaveBeenNthCalledWith(1, expect.objectContaining({ reason: 'tool-loop-continue', willContinue: true }));

    // The continuation request after the throw carries the error tool_result.
    const continuationBody = toOpenAIChatCompletionsBody(transport.mock.calls[1][1]);
    expect(continuationBody.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', tool_call_id: 'call_1', content: expect.stringContaining('tool failed') }),
    ]));

    // The errored tool row stays inspectable.
    await user.click(screen.getAllByRole('button', { name: /search/i })[0]);
    expect(screen.getByText(/tool failed/)).toBeInTheDocument();
  });

  it('records a thrown tool error without the banner when continueOnToolError is set but autoContinueTools is off', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":"react"}' } }] } }] }),
      '[DONE]',
    ]));

    render(<Chorus
      transport={transport}
      connector="openai"
      minAssistantDelayMs={0}
      continueOnToolError
      tools={{ search: async () => { throw new Error('tool failed'); } }}
      onError={onError}
    />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'search react');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('button', { name: /search/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(transport).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /search/i }));
    expect(screen.getByText(/tool failed/)).toBeInTheDocument();
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
    const onStreamDone = vi.fn();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: transport.mock.calls.length - 1, id: `call_${transport.mock.calls.length}`, function: { name: 'search', arguments: '{}' } }] } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} autoContinueTools maxToolIterations={1} tools={{ search }} onStreamDone={onStreamDone} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'loop');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(search).toHaveBeenCalledTimes(2);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(onStreamDone).toHaveBeenCalledTimes(2);
    expect(onStreamDone).toHaveBeenNthCalledWith(1, expect.objectContaining({
      reason: 'tool-loop-continue',
      willContinue: true,
      iteration: 1,
      maxToolIterations: 1,
    }));
    expect(onStreamDone).toHaveBeenNthCalledWith(2, expect.objectContaining({
      reason: 'max-tool-iterations',
      willContinue: false,
      iteration: 2,
      maxToolIterations: 1,
    }));
  });

  it('reports max-tool-iterations on the very first tool batch when maxToolIterations is 0', async () => {
    const user = userEvent.setup();
    const search = vi.fn(async () => ({ ok: true }));
    const onStreamDone = vi.fn();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{}' } }] } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} autoContinueTools maxToolIterations={0} tools={{ search }} onStreamDone={onStreamDone} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'loop');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(transport).toHaveBeenCalledTimes(1);
    expect(onStreamDone).toHaveBeenCalledTimes(1);
    expect(onStreamDone).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'max-tool-iterations',
      willContinue: false,
      iteration: 1,
      maxToolIterations: 0,
      toolMessages: [expect.objectContaining({ toolCall: expect.objectContaining({ id: 'call_1' }) })],
    }));
  });

  it('reports completed when a transport stream ends with no auto-continue tool calls', async () => {
    const user = userEvent.setup();
    const onStreamDone = vi.fn();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { content: 'hi there' } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} onStreamDone={onStreamDone} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await screen.findByText('hi there');
    expect(onStreamDone).toHaveBeenCalledTimes(1);
    expect(onStreamDone).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'completed',
      willContinue: false,
      iteration: 1,
      maxToolIterations: 4,
    }));
  });

  it('reports tool-loop-veto when shouldContinueToolLoop returns false', async () => {
    const user = userEvent.setup();
    const search = vi.fn(async () => ({ ok: true }));
    const onStreamDone = vi.fn();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{}' } }] } }] }),
      '[DONE]',
    ]));

    render(<Chorus
      transport={transport}
      connector="openai"
      minAssistantDelayMs={0}
      autoContinueTools
      tools={{ search }}
      shouldContinueToolLoop={() => false}
      onStreamDone={onStreamDone}
    />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'veto');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(transport).toHaveBeenCalledTimes(1);
    expect(onStreamDone).toHaveBeenCalledTimes(1);
    expect(onStreamDone).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'tool-loop-veto',
      willContinue: false,
      iteration: 1,
      maxToolIterations: 4,
    }));
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

  it('dispatches send() to the transport from the same commit that swapped the transport prop', async () => {
    const transportA = vi.fn<Transport>(async () => sseResponse(['from A']));
    const transportB = vi.fn<Transport>(async () => sseResponse(['from B']));
    const ref = React.createRef<ChorusRef>();

    // The layout effect runs right after Chorus re-renders with transportB but
    // before any passive effect — exercising a "latest ref read inside the same
    // commit" path. A useLatestRef that updated in a passive effect would still
    // hold transportA at this point and post to the previous endpoint.
    function Host({ transport, sendNow }: { transport: Transport; sendNow: boolean }) {
      React.useLayoutEffect(() => {
        if (sendNow) ref.current?.send('same-commit send');
      }, [sendNow]);
      return <Chorus ref={ref} transport={transport} connector="openai" minAssistantDelayMs={0} />;
    }

    const { rerender } = render(<Host transport={transportA} sendNow={false} />);
    expect(transportA).not.toHaveBeenCalled();

    rerender(<Host transport={transportB} sendNow />);

    await waitFor(() => expect(transportB).toHaveBeenCalledOnce());
    expect(transportA).not.toHaveBeenCalled();
    expect(transportB.mock.calls[0][0]).toBe('same-commit send');
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
});
