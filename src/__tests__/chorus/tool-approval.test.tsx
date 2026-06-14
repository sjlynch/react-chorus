import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import { defineTool } from '../../tools';
import type { ChorusRef } from '../../Chorus.types';
import { makeSyncStorage, sendMessage, sseResponse, type Transport } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

function singleToolCallTransport(): ReturnType<typeof vi.fn<Transport>> {
  return vi.fn<Transport>(async () => sseResponse([
    JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'send_email', arguments: '{"to":"a@b.c"}' } }] } }] }),
    '[DONE]',
  ]));
}

describe('Chorus tool-call approvals', () => {
  it('renders an approval card and blocks execution until the user allows once', async () => {
    const user = userEvent.setup();
    const handler = vi.fn(async () => ({ sent: true }));
    const sendEmail = defineTool({ name: 'send_email', requiresApproval: true, handler });
    const transport = singleToolCallTransport();

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0}
      tools={[sendEmail]}
      toolPolicy={{ default: 'ask' }}
    />);

    await sendMessage(user, 'send the email');

    expect(await screen.findByText(/Approval required/)).toBeInTheDocument();
    expect(handler).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Allow once/ }));

    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Approval required/)).not.toBeInTheDocument();
  });

  it('records a denied tool result when the user denies', async () => {
    const user = userEvent.setup();
    const handler = vi.fn(async () => ({ sent: true }));
    const sendEmail = defineTool({ name: 'send_email', requiresApproval: true, handler });
    const transport = singleToolCallTransport();

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0}
      tools={[sendEmail]}
      toolPolicy={{ default: 'ask' }}
    />);

    await sendMessage(user, 'send the email');

    await user.click(await screen.findByRole('button', { name: /^Deny$/ }));

    await waitFor(() => expect(screen.queryByText(/Approval required/)).not.toBeInTheDocument());
    expect(handler).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /send_email/i }));
    expect(screen.getByText(/denied by user/)).toBeInTheDocument();
  });

  it('persists per-tool policy and skips the card on subsequent calls when "Allow always" is clicked', async () => {
    const user = userEvent.setup();
    const handler = vi.fn(async () => ({ sent: true }));
    const sendEmail = defineTool({ name: 'send_email', requiresApproval: true, handler });
    const transport = singleToolCallTransport();
    const storage = makeSyncStorage();

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0}
      tools={[sendEmail]}
      toolPolicy={{ default: 'ask' }}
      persistenceKey="chat-1"
      persistenceStorage={storage}
    />);

    await sendMessage(user, 'send the email');
    await user.click(await screen.findByRole('button', { name: /Allow always/ }));
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

    expect(storage.store['chat-1::tool-policy']).toBe(JSON.stringify({ send_email: 'allow' }));
  });

  it('skips approval for tools without requiresApproval even with default: ask', async () => {
    const user = userEvent.setup();
    const handler = vi.fn(async () => ({ ok: true }));
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_x', function: { name: 'lookup', arguments: '{}' } }] } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0}
      tools={{ lookup: handler }}
      toolPolicy={{ default: 'ask' }}
    />);

    await sendMessage(user, 'do it');

    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Approval required/)).not.toBeInTheDocument();
  });

  it('exposes ChorusRef.respondToApproval for host-driven approval UIs', async () => {
    const user = userEvent.setup();
    const handler = vi.fn(async () => ({ sent: true }));
    const sendEmail = defineTool({ name: 'send_email', requiresApproval: true, handler });
    const transport = singleToolCallTransport();
    const ref = React.createRef<ChorusRef>();

    render(<Chorus ref={ref} transport={transport} connector="openai" minAssistantDelayMs={0}
      tools={[sendEmail]}
      toolPolicy={{ default: 'ask' }}
    />);

    await sendMessage(user, 'send it');

    await screen.findByText(/Approval required/);
    // No pending approval is matched for an unknown id.
    expect(ref.current?.respondToApproval('nope', 'allow-once')).toBe(false);

    let accepted = false;
    await act(async () => {
      accepted = ref.current?.respondToApproval('call_1', 'allow-once') ?? false;
    });
    expect(accepted).toBe(true);
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
  });

  // Regression: `__run_code` was previously baked into RESERVED_UI_TOOL_NAMES
  // even though no `__run_code` pipeline exists. A host that named an
  // executable tool `__run_code` and asked for `default: 'ask'` would have its
  // tool run without the approval card ever rendering.
  it('gates a host tool named __run_code through the approval policy', async () => {
    const user = userEvent.setup();
    const handler = vi.fn(async () => ({ ran: true }));
    const runCode = defineTool({ name: '__run_code', requiresApproval: true, handler });
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_rc', function: { name: '__run_code', arguments: '{"code":"print(1)"}' } }] } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0}
      tools={[runCode]}
      toolPolicy={{ default: 'ask' }}
    />);

    await sendMessage(user, 'run it');

    expect(await screen.findByText(/Approval required/)).toBeInTheDocument();
    expect(handler).not.toHaveBeenCalled();
  });

  it('resolves a pending approval as denied with an (approval timed out) message when the timeout fires', async () => {
    const user = userEvent.setup();
    const handler = vi.fn(async () => ({ sent: true }));
    const sendEmail = defineTool({ name: 'send_email', requiresApproval: true, handler });
    const transport = singleToolCallTransport();

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0}
      tools={[sendEmail]}
      toolPolicy={{ default: 'ask' }}
      // 250ms is small enough to keep the test fast but large enough that
      // coverage-instrumented renders can mount the approval card before the
      // timeout fires — at 50ms the card-render race made this test flake
      // reproducibly under `npm run test:coverage`.
      approvalTimeoutMs={250}
    />);

    await sendMessage(user, 'send it');
    await screen.findByText(/Approval required/);

    await waitFor(() => expect(screen.queryByText(/Approval required/)).not.toBeInTheDocument(), { timeout: 2000 });
    expect(handler).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /send_email/i }));
    expect(screen.getByText(/approval timed out/i)).toBeInTheDocument();
  });
});
