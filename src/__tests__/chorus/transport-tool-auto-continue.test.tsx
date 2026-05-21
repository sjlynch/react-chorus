import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import { toAnthropicMessagesBody, toOpenAIChatCompletionsBody } from '../../providerRequests';
import { sendMessage, sseResponse } from './testUtils';
import type { Transport } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus automatic tool continuation', () => {
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

    await sendMessage(user, 'search react');

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

    await sendMessage(user, 'search react');

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

    await sendMessage(user, 'weather');

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

  it('fires onFinish once for a multi-iteration auto-continue turn', async () => {
    const user = userEvent.setup();
    const search = vi.fn(async () => ({ ok: true }));
    const onFinish = vi.fn();
    // Iterations 1 and 3 stream assistant text; iteration 3 is terminal. onFinish
    // must honor the documented once-per-turn contract rather than firing for the
    // intermediate iteration that also streamed text.
    const transport = vi.fn<Transport>(async () => {
      const call = transport.mock.calls.length;
      if (call === 1) {
        return sseResponse([
          JSON.stringify({ choices: [{ index: 0, delta: { content: 'Working on it.', tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":"a"}' } }] } }] }),
          '[DONE]',
        ]);
      }
      if (call === 2) {
        return sseResponse([
          JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_2', function: { name: 'search', arguments: '{"q":"b"}' } }] } }] }),
          '[DONE]',
        ]);
      }
      return sseResponse([
        JSON.stringify({ choices: [{ index: 0, delta: { content: 'All done.' } }] }),
        '[DONE]',
      ]);
    });

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} autoContinueTools tools={{ search }} onFinish={onFinish} />);

    await sendMessage(user, 'go');

    expect(await screen.findByText('All done.')).toBeInTheDocument();
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(search).toHaveBeenCalledTimes(2);

    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.objectContaining({ text: 'All done.' }),
      reason: 'done',
    }));
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

    await sendMessage(user, 'loop');

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

    await sendMessage(user, 'loop');

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

    await sendMessage(user, 'veto');

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

    await sendMessage(user, 'loop');

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

    await sendMessage(user, 'veto');

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

    await sendMessage(user, 'continue then stop');

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /stop/i }));

    await waitFor(() => expect(continuationSignal.aborted).toBe(true));
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
  });
});
