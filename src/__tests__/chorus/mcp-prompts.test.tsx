import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

// Drive the shell's MCP slash-command handler directly by stubbing the lazy MCP
// runtime: it advertises one prompt-with-required-args slash command and a
// controllable `applyPrompt`.
const { applyPrompt } = vi.hoisted(() => ({ applyPrompt: vi.fn() }));

vi.mock('../../chorus-shell/useLazyMcpRuntime', () => ({
  useLazyMcpRuntime: () => ({
    servers: [],
    tools: [],
    toolRegistry: {},
    prompts: [],
    slashCommands: [{ name: '/srv:summarize', description: 'Summarize — topic=<value>', requiresArguments: true }],
    resources: [],
    resourceAttachments: [],
    reconnect: vi.fn(),
    applyPrompt,
  }),
}));

describe('Chorus MCP prompt slash commands', () => {
  const servers = [{ url: 'http://localhost/sse' }];

  beforeEach(() => {
    applyPrompt.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards the command and key=value arguments to applyPrompt and fills the draft with the result', async () => {
    const user = userEvent.setup();
    applyPrompt.mockResolvedValue('A concise summary about cats.');
    const onSend = vi.fn();
    render(<Chorus mcpServers={servers} onSend={onSend} />);

    const textbox = screen.getByPlaceholderText('Send a message');
    await user.type(textbox, '/srv:summarize topic=cats{Enter}');

    await waitFor(() => expect(applyPrompt).toHaveBeenCalledWith('/srv:summarize topic=cats'), { timeout: 4000 });
    // The resolved prompt text replaces the draft; the command was not sent as a
    // normal user turn.
    await waitFor(() => expect(textbox).toHaveValue('A concise summary about cats.'), { timeout: 4000 });
    expect(onSend).not.toHaveBeenCalled();
    // This drives the full <Chorus> stack through userEvent, so give it generous
    // headroom — under a saturated parallel suite the default 5s test budget can
    // be exhausted by CPU starvation alone (the logic is also unit-covered).
  }, 15000);

  it('keeps the draft and warns (no unhandled rejection) when applyPrompt rejects', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyPrompt.mockRejectedValue(new Error('missing required argument "topic"'));
    render(<Chorus mcpServers={servers} />);

    const textbox = screen.getByPlaceholderText('Send a message');
    await user.type(textbox, '/srv:summarize{Enter}');

    await waitFor(() => expect(applyPrompt).toHaveBeenCalledWith('/srv:summarize'), { timeout: 4000 });
    // The command text is preserved so the user can add the missing argument...
    await waitFor(() => expect(textbox).toHaveValue('/srv:summarize'), { timeout: 4000 });
    // ...and the failure is surfaced as a dev warning rather than a crash.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not apply MCP prompt "/srv:summarize"'),
      expect.any(Error),
    );
  }, 15000);
});
