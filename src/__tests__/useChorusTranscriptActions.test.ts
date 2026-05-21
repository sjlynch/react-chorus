import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useChorusTranscriptActions } from '../hooks/useChorusTranscriptActions';
import type { Message } from '../types';

const MESSAGES: Message[] = [
  { id: 'u1', role: 'user', text: 'How do I deploy the app?' },
  { id: 'a1', role: 'assistant', text: 'Run the deploy script.', reasoning: 'Consider the CI pipeline first.' },
  {
    id: 't1',
    role: 'tool',
    toolCall: { name: 'searchDocs', input: { q: 'release notes' }, output: 'found at https://docs.example.com/setup-guide' },
  },
  { id: 's1', role: 'system', text: 'You are a helpful assistant.' },
  {
    id: 'u2',
    role: 'user',
    text: 'Here is a screenshot.',
    attachments: [{ name: 'shot.png', type: 'image/png', data: 'data:image/png;base64,AAAA', size: 4 }],
  },
];

function withClipboard<T>(writeText: ReturnType<typeof vi.fn>, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    return run();
  } finally {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
}

describe('useChorusTranscriptActions', () => {
  describe('searchMessages', () => {
    it('matches a case-insensitive substring of message text', () => {
      const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
      const hits = result.current.searchMessages('DEPLOY');
      expect(hits.map((m) => m.id)).toEqual(['u1', 'a1']);
    });

    it('matches a tool message by its tool-call name', () => {
      const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
      const hits = result.current.searchMessages('searchdocs');
      expect(hits.map((m) => m.id)).toEqual(['t1']);
    });

    it('matches a tool message by its serialized tool-call input', () => {
      const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
      expect(result.current.searchMessages('release notes').map((m) => m.id)).toEqual(['t1']);
    });

    it('matches a tool message by its tool-call output', () => {
      const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
      expect(result.current.searchMessages('setup-guide').map((m) => m.id)).toEqual(['t1']);
    });

    it('matches tool-call input and output case-insensitively', () => {
      const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
      expect(result.current.searchMessages('RELEASE NOTES').map((m) => m.id)).toEqual(['t1']);
      expect(result.current.searchMessages('DOCS.EXAMPLE.COM').map((m) => m.id)).toEqual(['t1']);
    });

    it('does not throw searching a circular tool value', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const messages: Message[] = [{ id: 't', role: 'tool', toolCall: { name: 'loop', output: circular } }];
      const { result } = renderHook(() => useChorusTranscriptActions(messages));
      expect(result.current.searchMessages('loop').map((m) => m.id)).toEqual(['t']);
    });

    it('matches message reasoning text', () => {
      const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
      const hits = result.current.searchMessages('ci pipeline');
      expect(hits.map((m) => m.id)).toEqual(['a1']);
    });

    it('returns the original message references', () => {
      const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
      expect(result.current.searchMessages('helpful')[0]).toBe(MESSAGES[3]);
    });

    it('returns [] for a blank or whitespace-only query', () => {
      const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
      expect(result.current.searchMessages('')).toEqual([]);
      expect(result.current.searchMessages('   ')).toEqual([]);
    });

    it('returns [] when nothing matches', () => {
      const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
      expect(result.current.searchMessages('kubernetes')).toEqual([]);
    });

    it('reflects the latest messages without changing callback identity', () => {
      const { result, rerender } = renderHook(({ messages }) => useChorusTranscriptActions(messages), {
        initialProps: { messages: MESSAGES },
      });
      const firstSearch = result.current.searchMessages;
      const extra: Message = { id: 'u3', role: 'user', text: 'deploy to staging now' };
      rerender({ messages: [...MESSAGES, extra] });
      expect(result.current.searchMessages).toBe(firstSearch);
      expect(result.current.searchMessages('staging').map((m) => m.id)).toEqual(['u3']);
    });
  });

  describe('exportAs', () => {
    it('round-trips JSON through JSON.parse(JSON.stringify(messages))', () => {
      const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
      const exported = result.current.exportAs('json');
      expect(JSON.parse(exported)).toEqual(JSON.parse(JSON.stringify(MESSAGES)));
    });

    it('renders a Markdown transcript with one heading per message', () => {
      const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
      const md = result.current.exportAs('markdown');
      expect(md).toContain('## User');
      expect(md).toContain('## Assistant');
      expect(md).toContain('## System');
      expect(md).toContain('## Tool: searchDocs');
      expect(md).toContain('Run the deploy script.');
      expect(md).toContain('**Input:**');
      expect(md).toContain('**Output:**');
      expect(md).toContain('📎 shot.png');
    });

    it('does not throw on a circular tool value in a Markdown export', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const messages: Message[] = [{ id: 't', role: 'tool', toolCall: { name: 'loop', output: circular } }];
      const { result } = renderHook(() => useChorusTranscriptActions(messages));
      const md = result.current.exportAs('markdown');
      expect(md).toContain('## Tool: loop');
      expect(md).toContain('**Output:**');
    });

    it('honors custom role labels for Markdown headings', () => {
      const { result } = renderHook(() =>
        useChorusTranscriptActions(MESSAGES, { roleLabels: { user: 'Customer', assistant: 'Agent' } }),
      );
      const md = result.current.exportAs('markdown');
      expect(md).toContain('## Customer');
      expect(md).toContain('## Agent');
      expect(md).toContain('## System');
    });
  });

  describe('copyAll', () => {
    it('copies the Markdown transcript by default', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
      const ok = await withClipboard(writeText, () => result.current.copyAll());
      expect(ok).toBe(true);
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText.mock.calls[0][0]).toContain('## User');
    });

    it('copies JSON when asked', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
      await withClipboard(writeText, () => result.current.copyAll('json'));
      expect(JSON.parse(writeText.mock.calls[0][0])).toEqual(JSON.parse(JSON.stringify(MESSAGES)));
    });

    it('resolves false without writing or reporting an error on an empty transcript', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      const onCopyError = vi.fn();
      const { result } = renderHook(() => useChorusTranscriptActions([], { onCopyError }));
      const ok = await withClipboard(writeText, () => result.current.copyAll());
      expect(ok).toBe(false);
      expect(writeText).not.toHaveBeenCalled();
      expect(onCopyError).not.toHaveBeenCalled();
    });

    it('resolves false and reports an error when the Clipboard API is unavailable', async () => {
      const onCopyError = vi.fn();
      const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      Reflect.deleteProperty(navigator, 'clipboard');
      try {
        const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES, { onCopyError }));
        const ok = await result.current.copyAll();
        expect(ok).toBe(false);
        expect(onCopyError).toHaveBeenCalledTimes(1);
      } finally {
        if (original) Object.defineProperty(navigator, 'clipboard', original);
      }
    });
  });
});
