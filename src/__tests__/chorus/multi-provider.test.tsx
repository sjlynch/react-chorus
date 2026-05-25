import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderChorus, sendMessage, sseResponse, type Transport } from './testUtils';

function openaiChunks(text: string): string[] {
  return [
    JSON.stringify({ choices: [{ delta: { content: text } }] }),
    '[DONE]',
  ];
}

function anthropicChunks(text: string): string[] {
  return [
    JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }),
    JSON.stringify({ type: 'message_stop' }),
  ];
}

function geminiChunks(text: string): string[] {
  return [
    JSON.stringify({ candidates: [{ index: 0, content: { parts: [{ text }] }, finishReason: 'STOP' }] }),
  ];
}

describe('<Chorus providers>', () => {
  it('routes to the default provider with the matching connector and tags the assistant message', async () => {
    const openaiTransport: Transport = vi.fn(async () => sseResponse(openaiChunks('hi from openai')));
    const anthropicTransport: Transport = vi.fn(async () => sseResponse(anthropicChunks('hi from anthropic')));

    const { user } = renderChorus({
      providers: {
        gpt: { transport: openaiTransport, connector: 'openai', label: 'OpenAI', modelId: 'gpt-4o-mini' },
        claude: { transport: anthropicTransport, connector: 'anthropic', label: 'Claude', modelId: 'claude-3-5' },
      },
      defaultProvider: 'gpt',
      minAssistantDelayMs: 0,
    });

    await sendMessage(user, 'hello');

    // The default-provider's transport saw the request, the other did not.
    expect(openaiTransport).toHaveBeenCalledTimes(1);
    expect(anthropicTransport).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(document.body.textContent).toContain('hi from openai');
    }, { timeout: 5000 });
    // Model badge surfaces the routed provider id and model id.
    expect(screen.getByLabelText(/Provider: gpt/i)).toBeInTheDocument();
    expect(screen.getByText('gpt')).toBeInTheDocument();
    expect(screen.getByText(/gpt-4o-mini/)).toBeInTheDocument();
  });

  it('switches the next turn to the picker-selected provider', async () => {
    const openaiTransport: Transport = vi.fn(async () => sseResponse(openaiChunks('first turn')));
    const geminiTransport: Transport = vi.fn(async () => sseResponse(geminiChunks('second turn')));

    const { user } = renderChorus({
      providers: {
        gpt: { transport: openaiTransport, connector: 'openai', label: 'OpenAI' },
        gemini: { transport: geminiTransport, connector: 'gemini', label: 'Gemini' },
      },
      defaultProvider: 'gpt',
      minAssistantDelayMs: 0,
    });

    await sendMessage(user, 'first');
    await waitFor(() => expect(document.body.textContent).toContain('first turn'), { timeout: 5000 });

    // Pick the other provider via the inline composer dropdown.
    const picker = screen.getByLabelText(/Provider/i, { selector: 'select' });
    await user.selectOptions(picker, 'gemini');

    await sendMessage(user, 'second');
    await waitFor(() => expect(document.body.textContent).toContain('second turn'), { timeout: 5000 });

    expect(geminiTransport).toHaveBeenCalledTimes(1);
    expect(openaiTransport).toHaveBeenCalledTimes(1);
  });

  it('switches the active provider via the /model:<id> slash command without sending the literal text', async () => {
    const openaiTransport: Transport = vi.fn(async () => sseResponse(openaiChunks('opener')));
    const anthropicTransport: Transport = vi.fn(async () => sseResponse(anthropicChunks('switched reply')));

    const { user } = renderChorus({
      providers: {
        gpt: { transport: openaiTransport, connector: 'openai', label: 'OpenAI' },
        claude: { transport: anthropicTransport, connector: 'anthropic', label: 'Claude' },
      },
      defaultProvider: 'gpt',
      minAssistantDelayMs: 0,
    });

    const composer = screen.getByPlaceholderText('Send a message');
    await user.type(composer, '/model:claude');
    await user.keyboard('{Enter}');

    // The literal `/model:claude` command never reaches the model; only a real
    // turn does. After the switch, the composer is cleared and the picker
    // reflects the new active provider.
    expect(openaiTransport).not.toHaveBeenCalled();
    expect(anthropicTransport).not.toHaveBeenCalled();
    expect((composer as HTMLTextAreaElement).value).toBe('');
    const picker = screen.getByLabelText(/Provider/i, { selector: 'select' }) as HTMLSelectElement;
    expect(picker.value).toBe('claude');

    await sendMessage(user, 'go');
    await waitFor(() => expect(document.body.textContent).toContain('switched reply'), { timeout: 5000 });
    expect(anthropicTransport).toHaveBeenCalledTimes(1);
    expect(openaiTransport).not.toHaveBeenCalled();
  });

  it('persists provider and modelId on assistant messages across reloads', async () => {
    const openaiTransport: Transport = vi.fn(async () => sseResponse(openaiChunks('persisted reply')));

    const storage = (() => {
      const store: Record<string, string> = {};
      return {
        store,
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => { store[key] = value; },
        removeItem: (key: string) => { delete store[key]; },
      };
    })();

    const { user, unmount } = renderChorus({
      providers: {
        gpt: { transport: openaiTransport, connector: 'openai', label: 'OpenAI', modelId: 'gpt-4o-mini' },
      },
      defaultProvider: 'gpt',
      persistenceKey: 'multi-provider-test',
      persistenceStorage: storage,
      minAssistantDelayMs: 0,
    });

    await sendMessage(user, 'hello');
    await waitFor(() => expect(document.body.textContent).toContain('persisted reply'), { timeout: 5000 });

    unmount();

    const persisted = storage.store['multi-provider-test'];
    expect(persisted).toBeTruthy();
    const parsed = JSON.parse(persisted!);
    const assistant = parsed.find((m: { role: string }) => m.role === 'assistant');
    expect(assistant.provider).toBe('gpt');
    expect(assistant.modelId).toBe('gpt-4o-mini');
  });
});
