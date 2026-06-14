import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import { useChorusStream } from '../../hooks/useChorusStream';
import { sendMessage, sseResponse } from './testUtils';
import type { OnSend, Transport } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

// gpt-4o pricing is { in: 0.0025, out: 0.01 } per 1k tokens, so 1000 prompt +
// 2000 completion tokens cost (2.5 + 20) / 1000 = $0.0225 → "$0.02", and the
// chip token count is 1000 + 2000 = 3000.
const EXPECTED_TOTAL = '$0.02';
const EXPECTED_TOKENS = '3,000 tok';

async function expectCostMeterPopulated(container: HTMLElement) {
  await waitFor(() => {
    const total = container.querySelector('.chorus-cost-header-total');
    expect(total?.textContent).toContain(EXPECTED_TOTAL);
  });
  const chip = container.querySelector('.chorus-cost-chip');
  expect(chip).toBeInTheDocument();
  expect(chip?.getAttribute('aria-label')).toContain(EXPECTED_TOKENS);
}

describe('<Chorus showCost> onSend cost-meter recipe', () => {
  it('drives the cost meter from a non-streaming finalizeAssistant({ text, metadata: { usage } })', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // The documented recipe attaches the *raw* provider usage shape
    // (input_tokens / output_tokens), so this is the regression guard that the
    // meter normalizes it instead of leaving the chip at $0.
    const onSend = vi.fn<OnSend>((_text, _messages, helpers) => {
      helpers.finalizeAssistant({
        text: 'finalized reply',
        metadata: {
          modelId: 'gpt-4o',
          usage: { input_tokens: 1000, output_tokens: 2000 },
        },
      });
    });

    const { container } = render(<Chorus onSend={onSend} showCost minAssistantDelayMs={0} />);

    await sendMessage(user, 'cost please');

    expect(await screen.findByText('finalized reply')).toBeInTheDocument();
    await expectCostMeterPopulated(container);
    warn.mockRestore();
  });

  it('drives the cost meter when usage is attached via a metadata-only finalize after streaming text', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onSend = vi.fn<OnSend>((_text, _messages, helpers) => {
      helpers.appendAssistant('streamed reply');
      // Usage arrives separately, with no `text` — the raw OpenAI-Chat aliases.
      helpers.finalizeAssistant({
        metadata: { usage: { prompt_tokens: 1000, completion_tokens: 2000, total_tokens: 3000 } },
      });
    });

    const { container } = render(
      <Chorus onSend={onSend} showCost modelId="gpt-4o" minAssistantDelayMs={0} />,
    );

    await sendMessage(user, 'cost please');

    expect(await screen.findByText('streamed reply')).toBeInTheDocument();
    await expectCostMeterPopulated(container);
    warn.mockRestore();
  });

  it('drives the cost meter from a bridged send via streamCallbacks().onMetadata', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bridgeTransport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { content: 'bridged answer' } }] }),
      JSON.stringify({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 2000, total_tokens: 3000 } }),
      '[DONE]',
    ]));

    function Bridge() {
      const { send } = useChorusStream(bridgeTransport, { connector: 'openai' });
      return (
        <Chorus
          showCost
          modelId="gpt-4o"
          minAssistantDelayMs={0}
          onSend={(text, messages, helpers) => send(text, messages, helpers.streamCallbacks(), helpers.signal)}
        />
      );
    }

    const { container } = render(<Bridge />);

    await sendMessage(user, 'bridge cost');

    expect(await screen.findByText('bridged answer')).toBeInTheDocument();
    await expectCostMeterPopulated(container);
    warn.mockRestore();
  });
});
