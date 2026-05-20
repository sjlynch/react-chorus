import { describe, it, expect } from 'vitest';
import { normalizeReturnedMessage } from '../hooks/assistant-session/messageUtils';

describe('normalizeReturnedMessage', () => {
  it('generates a stable toolCall.id for a tool message that lacks a toolCall', () => {
    const normalized = normalizeReturnedMessage({ role: 'tool', text: 'result' });
    expect(normalized.role).toBe('tool');
    expect(normalized.toolCall.name).toBe('tool');
    expect(typeof normalized.toolCall.id).toBe('string');
    expect(normalized.toolCall.id).toBeTruthy();
  });

  it('generates a toolCall.id when a returned toolCall omits its id', () => {
    const normalized = normalizeReturnedMessage({
      role: 'tool',
      text: 'result',
      toolCall: { name: 'lookup', input: { q: 1 } },
    });
    expect(typeof normalized.toolCall.id).toBe('string');
    expect(normalized.toolCall.id).toBeTruthy();
    expect(normalized.toolCall.name).toBe('lookup');
    expect(normalized.toolCall.input).toEqual({ q: 1 });
  });

  it('preserves an explicit toolCall.id', () => {
    const normalized = normalizeReturnedMessage({
      role: 'tool',
      toolCall: { id: 'call_abc', name: 'lookup' },
    });
    expect(normalized.toolCall.id).toBe('call_abc');
  });

  it('gives two onSend-returned tool messages independently addressable ids', () => {
    const first = normalizeReturnedMessage({ role: 'tool', text: 'a' });
    const second = normalizeReturnedMessage({ role: 'tool', text: 'b' });
    expect(first.toolCall.id).not.toBe(second.toolCall.id);
  });
});
