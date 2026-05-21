import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import { defineTool } from '../../providerRequests';
import { sendMessage, sseResponse } from './testUtils';
import type { Transport } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus transport tool execution', () => {
  it('renders streamed connector tool calls as visible tool rows by default', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":' } }] } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"test"}' } }] } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await sendMessage(user, 'use a tool');

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

    await sendMessage(user, 'use a tool');

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

  it('finishes a tool-only Anthropic stream and invokes onToolCall with actionable context', async () => {
    const user = userEvent.setup();
    const onToolCall = vi.fn();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'lookup', input: {} } }),
      JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"city":"Paris"}' } }),
      JSON.stringify({ type: 'message_stop' }),
    ]));

    render(<Chorus transport={transport} connector="anthropic" minAssistantDelayMs={0} onToolCall={onToolCall} />);

    await sendMessage(user, 'use anthropic tool');

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

    await sendMessage(user, 'search react');

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

    await sendMessage(user, 'go');

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

    await sendMessage(user, 'parallel tools');

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

    await sendMessage(user, 'search react');

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

    await sendMessage(user, 'search react');

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /search/i }));
    expect(screen.getByText(/tool failed/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /retry/i }));

    expect(await screen.findByText('fresh success')).toBeInTheDocument();
    expect(screen.queryByText(/tool failed/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /search/i })).not.toBeInTheDocument();
    expect(transport).toHaveBeenCalledTimes(2);
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

    await sendMessage(user, 'search react');

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

    await sendMessage(user, 'slow tool');

    expect(await screen.findByRole('button', { name: /slow_tool/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /stop/i }));

    await waitFor(() => expect(capturedSignal.aborted).toBe(true));
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(onError).not.toHaveBeenCalled();
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

    await sendMessage(user, 'search react');

    expect(await screen.findByTestId('custom-tool')).toHaveTextContent('Custom search');
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
  });
});
