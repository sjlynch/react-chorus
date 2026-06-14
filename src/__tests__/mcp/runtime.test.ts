import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { createMcpRuntime } from '../../mcp/runtime';
import type { McpClient, McpClientSnapshot, McpPrompt, McpServerConfig } from '../../mcp/types';

// Keep `resolveMcpServerName`/`qualifyMcpName` real (the runtime relies on them
// for routing) but stub `createMcpClient` so the runtime talks to a fake server.
vi.mock('../../mcp/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../mcp/client')>();
  return { ...actual, createMcpClient: vi.fn() };
});

import { createMcpClient } from '../../mcp/client';

const CONFIG: McpServerConfig = { name: 'srv', url: 'http://localhost/sse' };

function makePrompt(): McpPrompt {
  return {
    serverName: 'srv',
    name: 'summarize',
    qualifiedName: 'srv:summarize',
    slashCommand: '/srv:summarize',
    title: 'Summarize',
    description: 'Summarize a document',
    arguments: [
      { name: 'topic', description: 'What to summarize', required: true },
      { name: 'style', description: 'Tone', required: false },
    ],
    raw: {},
  };
}

interface Harness {
  getPrompt: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

function setup(getPromptImpl?: McpClient['getPrompt']): Harness {
  const getPrompt = vi.fn(getPromptImpl ?? (async () => ({
    messages: [{ role: 'user', content: { type: 'text', text: 'Summary of cats' } }],
  })));
  const disconnect = vi.fn(async () => {});
  const snapshot: McpClientSnapshot = {
    server: { name: 'srv', url: CONFIG.url, transport: 'sse', status: 'connected', reconnectAttempt: 0 },
    tools: [],
    prompts: [makePrompt()],
    resources: [],
  };
  const fakeClient = {
    connect: vi.fn(async () => snapshot),
    reconnect: vi.fn(async () => snapshot),
    disconnect,
    getPrompt,
  } as unknown as McpClient;
  vi.mocked(createMcpClient).mockImplementation(() => fakeClient);
  return { getPrompt, disconnect };
}

describe('createMcpRuntime — MCP prompt arguments', () => {
  let runtime: ReturnType<typeof createMcpRuntime>;

  beforeEach(() => {
    vi.mocked(createMcpClient).mockReset();
  });

  afterEach(() => {
    runtime?.dispose();
  });

  async function startConnected(harness: Harness) {
    runtime = createMcpRuntime([CONFIG], () => {});
    runtime.start();
    await waitFor(() => expect(runtime.snapshot.prompts.length).toBeGreaterThan(0));
    return harness;
  }

  it('surfaces required/optional argument hints and a requiresArguments flag in the slash command', async () => {
    await startConnected(setup());

    const command = runtime.snapshot.slashCommands.find(c => c.name === '/srv:summarize');
    expect(command).toBeDefined();
    expect(command?.requiresArguments).toBe(true);
    // Required args are listed bare, optional ones in brackets — both advertise
    // the `key=value` syntax so the user knows what to type.
    expect(command?.description).toContain('Summarize a document');
    expect(command?.description).toContain('topic=<value>');
    expect(command?.description).toContain('[style=<value>]');
  });

  it('parses `key=value` arguments (including quoted values) into getPrompt', async () => {
    const { getPrompt } = await startConnected(setup());

    const result = await runtime.applyPrompt('/srv:summarize topic=cats style="very brief"');

    expect(getPrompt).toHaveBeenCalledWith('summarize', { arguments: { topic: 'cats', style: 'very brief' } });
    expect(result).toBe('Summary of cats');
  });

  it('preserves the no-argument call shape for argument-free invocations', async () => {
    const { getPrompt } = await startConnected(setup());

    await runtime.applyPrompt('/srv:summarize');

    // No `arguments` field is passed so argument-free prompts behave exactly as
    // they did before the argument flow was added.
    expect(getPrompt).toHaveBeenLastCalledWith('summarize');
  });

  it('propagates a rejected getPrompt so the caller can keep the draft and surface the error', async () => {
    const { getPrompt } = await startConnected(setup(async () => {
      throw new Error('missing required argument "topic"');
    }));

    await expect(runtime.applyPrompt('/srv:summarize')).rejects.toThrow('missing required argument "topic"');
    expect(getPrompt).toHaveBeenCalledTimes(1);
  });

  it('returns the raw command unchanged when no prompt matches', async () => {
    const { getPrompt } = await startConnected(setup());

    const result = await runtime.applyPrompt('/srv:unknown topic=cats');

    expect(result).toBe('/srv:unknown topic=cats');
    expect(getPrompt).not.toHaveBeenCalled();
  });
});
