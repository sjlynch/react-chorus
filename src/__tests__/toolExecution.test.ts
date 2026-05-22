import { describe, it, expect } from 'vitest';
import {
  buildToolMessageFromDelta,
  createToolCallContextFromMessage,
} from '../hooks/assistant-session/toolExecution';
import type { ConnectorToolDelta } from '../connectors/connectors';

describe('buildToolMessageFromDelta tool-name fallback', () => {
  it('falls back to the delta id when the connector streams an empty-string name', () => {
    const delta: ConnectorToolDelta = { id: 'call_1', name: '' };
    const message = buildToolMessageFromDelta('m1', delta);
    expect(message.toolCall.name).toBe('call_1');
  });

  it('falls back to the delta id when the name is omitted', () => {
    const message = buildToolMessageFromDelta('m1', { id: 'call_1' });
    expect(message.toolCall.name).toBe('call_1');
  });

  it('keeps a non-empty streamed name', () => {
    const message = buildToolMessageFromDelta('m1', { id: 'call_1', name: 'search' });
    expect(message.toolCall.name).toBe('search');
  });

  it('reuses an existing non-empty name when a later delta omits its name', () => {
    const existing = buildToolMessageFromDelta('m1', { id: 'call_1', name: 'search' });
    const next = buildToolMessageFromDelta('m1', { id: 'call_1', input: { q: 1 } }, existing);
    expect(next.toolCall.name).toBe('search');
  });

  it('does not let an empty-string existing name shadow the id fallback', () => {
    const existing = buildToolMessageFromDelta('m1', { id: 'call_1', name: '' });
    const next = buildToolMessageFromDelta('m1', { id: 'call_1' }, existing);
    expect(next.toolCall.name).toBe('call_1');
  });

  it('agrees with createToolCallContextFromMessage on the resolved name for an empty streamed name', () => {
    const message = buildToolMessageFromDelta('m1', { id: 'call_1', name: '' });
    const context = createToolCallContextFromMessage(message, [message], new AbortController().signal);
    expect(context).not.toBeNull();
    // The stored toolCall.name and the execution-context name must match so
    // handler resolution and the rendered row label never disagree.
    expect(context?.name).toBe(message.toolCall.name);
    expect(context?.name).toBe('call_1');
  });
});
