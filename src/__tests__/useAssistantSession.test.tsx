import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

type HarnessTransport = Parameters<typeof useAssistantSession>[0]['transport'];

function useTransportHarness(transport: HarnessTransport) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const messagesRef = React.useRef<Message[]>([]);
  const onChunkRef = React.useRef<((chunk: string, id: string) => void) | undefined>(undefined);

  const updateMessages = React.useCallback((updater: (prev: Message[]) => Message[]) => {
    const next = updater(messagesRef.current);
    messagesRef.current = next;
    setMessages(next);
    return next;
  }, []);

  return useAssistantSession({
    messages,
    updateMessages,
    seedMessages: [],
    transport,
    minAssistantDelayMs: 0,
    fallbackErrorMessage: 'failed',
    onChunkRef,
    flushPersistence: vi.fn(),
  });
}

const TRANSPORT_WARNING = 'transport URL is empty/missing';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

  it('ignores an inline edit that resolves to empty text instead of triggering an assistant turn', async () => {
    const onSend = vi.fn<ChorusOnSend>(async () => ({ id: 'a1', role: 'assistant', text: 'hook reply' }));
    const { result } = renderHook(() => useHarness(onSend));

    act(() => {
      expect(result.current.session.send('hello')).toBe(true);
    });

    await waitFor(() => expect(result.current.messages).toEqual([
      expect.objectContaining({ role: 'user', text: 'hello' }),
      expect.objectContaining({ role: 'assistant', text: 'hook reply' }),
    ]));

    const userId = result.current.messages[0]!.id;
    const messagesBeforeEdit = result.current.messages;
    onSend.mockClear();

    act(() => {
      result.current.session.handleEdit(userId, '   ');
    });

    expect(onSend).not.toHaveBeenCalled();
    expect(result.current.messages).toBe(messagesBeforeEdit);
    expect(result.current.messages[0]).toEqual(expect.objectContaining({ text: 'hello' }));
  });

  describe('misconfigured transport resolver', () => {
    it('warns in dev when transport is an empty string', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      renderHook(() => useTransportHarness(''));

      expect(warn).toHaveBeenCalledWith(expect.stringContaining(TRANSPORT_WARNING));
    });

    it('warns in dev when transport is a whitespace-only string', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      renderHook(() => useTransportHarness('   '));

      expect(warn).toHaveBeenCalledWith(expect.stringContaining(TRANSPORT_WARNING));
    });

    it('warns in dev when transport is an object with an empty url', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const transport = { url: '' };

      renderHook(() => useTransportHarness(transport));

      expect(warn).toHaveBeenCalledWith(expect.stringContaining(TRANSPORT_WARNING));
    });

    it('warns in dev when transport is an object with an undefined url', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      // A JS caller building this object from an unset env var lands here.
      const transport = { url: undefined } as unknown as HarnessTransport;

      renderHook(() => useTransportHarness(transport));

      expect(warn).toHaveBeenCalledWith(expect.stringContaining(TRANSPORT_WARNING));
    });

    it('warns in dev when transport is an object with a typo\'d key (no url)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const transport = { uri: '/api/chat' } as unknown as HarnessTransport;

      renderHook(() => useTransportHarness(transport));

      expect(warn).toHaveBeenCalledWith(expect.stringContaining(TRANSPORT_WARNING));
    });

    it('does not warn when transport is genuinely absent (keeps the silent empty-200 fallback)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      renderHook(() => useTransportHarness(undefined));

      expect(warn).not.toHaveBeenCalled();
    });

    it('does not warn when transport is a usable URL string', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      renderHook(() => useTransportHarness('/api/chat'));

      expect(warn).not.toHaveBeenCalled();
    });

    it('surfaces a stream error instead of an empty turn when transport is misconfigured', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const transport = { url: '' };
      const { result } = renderHook(() => useTransportHarness(transport));

      act(() => {
        result.current.send('hello');
      });

      await waitFor(() => expect(result.current.streamError).toBe('failed'));
      expect(result.current.streamRawError).toBeInstanceOf(Error);
      expect(result.current.streamRawError?.message).toContain('transport is misconfigured');
    });
  });
});
