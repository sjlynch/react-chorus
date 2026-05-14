import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAssistantSession, type ChorusOnSend } from '../hooks/useAssistantSession';
import type { Message } from '../types';

function useHarness(onSend: ChorusOnSend = async () => ({ id: 'a1', role: 'assistant', text: 'hook reply' })) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const messagesRef = React.useRef<Message[]>([]);
  const onChunkRef = React.useRef<((chunk: string, id: string) => void) | undefined>(undefined);

  const updateMessages = React.useCallback((updater: (prev: Message[]) => Message[]) => {
    const next = updater(messagesRef.current);
    messagesRef.current = next;
    setMessages(next);
    return next;
  }, []);

  const session = useAssistantSession({
    messages,
    updateMessages,
    seedMessages: [],
    onSend,
    minAssistantDelayMs: 0,
    fallbackErrorMessage: 'failed',
    onChunkRef,
    flushPersistence: vi.fn(),
  });

  return { messages, session };
}

describe('useAssistantSession', () => {
  it('drives send orchestration independently from the Chorus component', async () => {
    const onSend = vi.fn<ChorusOnSend>(async () => ({ id: 'a1', role: 'assistant', text: 'hook reply' }));
    const { result } = renderHook(() => useHarness(onSend));

    act(() => {
      expect(result.current.session.send('hello')).toBe(true);
    });

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('hello', [expect.objectContaining({ role: 'user', text: 'hello' })], expect.any(Object)));
    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({ role: 'user', text: 'hello' }),
      expect.objectContaining({ role: 'assistant', text: 'hook reply' }),
    ]));
  });
});
