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

    it('matches an assistant message by its reasoning text', () => {
      const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
      const hits = result.current.searchMessages('ci pipeline');
      expect(hits.map((m) => m.id)).toEqual(['a1']);
    });

    it('matches a message by an attachment file name', () => {
      const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
      expect(result.current.searchMessages('shot.png').map((m) => m.id)).toEqual(['u2']);
      expect(result.current.searchMessages('SHOT.PNG').map((m) => m.id)).toEqual(['u2']);
    });

    it('does not match reasoning carried on a non-assistant message', () => {
      // exportMarkdown only renders reasoning for assistant messages, so search
      // ignores it elsewhere to keep the search/export contract symmetric.
      const messages: Message[] = [{ id: 's', role: 'system', text: 'visible', reasoning: 'hidden thought' }];
      const { result } = renderHook(() => useChorusTranscriptActions(messages));
      expect(result.current.searchMessages('hidden thought')).toEqual([]);
    });

    it('matches every string exportAs("markdown") renders, and vice versa', () => {
      const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
      const md = result.current.exportAs('markdown');
      // Assistant reasoning: rendered in the export AND findable via search.
      expect(md).toContain('Consider the CI pipeline first.');
      expect(result.current.searchMessages('Consider the CI pipeline first.').map((m) => m.id)).toEqual(['a1']);
      // Attachment file name: rendered in the export AND findable via search.
      expect(md).toContain('shot.png');
      expect(result.current.searchMessages('shot.png').map((m) => m.id)).toEqual(['u2']);
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

    it('renders an assistant message\'s reasoning under a **Reasoning:** block', () => {
      const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
      const md = result.current.exportAs('markdown');
      expect(md).toContain('**Reasoning:**');
      expect(md).toContain('Consider the CI pipeline first.');
    });

    it('does not render reasoning carried on a non-assistant message', () => {
      const messages: Message[] = [{ id: 's', role: 'system', text: 'visible', reasoning: 'hidden thought' }];
      const { result } = renderHook(() => useChorusTranscriptActions(messages));
      const md = result.current.exportAs('markdown');
      expect(md).toContain('visible');
      expect(md).not.toContain('**Reasoning:**');
      expect(md).not.toContain('hidden thought');
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

  describe('downloadAs', () => {
    type ObjectUrlKey = 'createObjectURL' | 'revokeObjectURL';

    /** Temporarily swap a `URL` object-URL method, restoring it afterwards. */
    function patchUrl(key: ObjectUrlKey, value: unknown): () => void {
      const original = Object.getOwnPropertyDescriptor(URL, key);
      Object.defineProperty(URL, key, { configurable: true, writable: true, value });
      return () => {
        if (original) Object.defineProperty(URL, key, original);
        else Reflect.deleteProperty(URL as unknown as Record<string, unknown>, key);
      };
    }

    async function withDownloadEnv<T>(
      run: (env: {
        createObjectURL: ReturnType<typeof vi.fn>;
        revokeObjectURL: ReturnType<typeof vi.fn>;
        anchors: HTMLAnchorElement[];
      }) => T | Promise<T>,
    ): Promise<T> {
      const createObjectURL = vi.fn(() => 'blob:transcript');
      const revokeObjectURL = vi.fn();
      const restore = [patchUrl('createObjectURL', createObjectURL), patchUrl('revokeObjectURL', revokeObjectURL)];
      const anchors: HTMLAnchorElement[] = [];
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(function (this: HTMLAnchorElement) {
          anchors.push(this);
        });
      try {
        return await run({ createObjectURL, revokeObjectURL, anchors });
      } finally {
        clickSpy.mockRestore();
        restore.forEach((fn) => fn());
      }
    }

    it('downloads Markdown with a default filename and a text/markdown blob', async () => {
      await withDownloadEnv(async ({ createObjectURL, revokeObjectURL, anchors }) => {
        const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
        const ok = result.current.downloadAs('markdown');
        expect(ok).toBe(true);
        expect(anchors).toHaveLength(1);
        expect(anchors[0].download).toBe('transcript.md');
        expect(createObjectURL).toHaveBeenCalledTimes(1);
        const blob = createObjectURL.mock.calls[0][0] as Blob;
        expect(blob.type).toBe('text/markdown');
        expect(await blob.text()).toContain('## User');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:transcript');
      });
    });

    it('downloads JSON with the json extension and an application/json blob', async () => {
      await withDownloadEnv(async ({ createObjectURL, anchors }) => {
        const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
        expect(result.current.downloadAs('json')).toBe(true);
        expect(anchors[0].download).toBe('transcript.json');
        const blob = createObjectURL.mock.calls[0][0] as Blob;
        expect(blob.type).toBe('application/json');
        expect(JSON.parse(await blob.text())).toEqual(JSON.parse(JSON.stringify(MESSAGES)));
      });
    });

    it('appends the format extension to a caller filename that lacks one', async () => {
      await withDownloadEnv(({ anchors }) => {
        const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
        result.current.downloadAs('markdown', 'my-chat');
        expect(anchors[0].download).toBe('my-chat.md');
      });
    });

    it('honors a caller filename that already has an extension', async () => {
      await withDownloadEnv(({ anchors }) => {
        const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
        result.current.downloadAs('json', 'export.txt');
        expect(anchors[0].download).toBe('export.txt');
      });
    });

    it('returns false without downloading an empty transcript', async () => {
      await withDownloadEnv(({ createObjectURL, anchors }) => {
        const { result } = renderHook(() => useChorusTranscriptActions([]));
        expect(result.current.downloadAs('markdown')).toBe(false);
        expect(createObjectURL).not.toHaveBeenCalled();
        expect(anchors).toHaveLength(0);
      });
    });

    it('returns false when object URLs are unavailable (e.g. SSR)', () => {
      const restore = patchUrl('createObjectURL', undefined);
      try {
        const { result } = renderHook(() => useChorusTranscriptActions(MESSAGES));
        expect(result.current.downloadAs('markdown')).toBe(false);
      } finally {
        restore();
      }
    });
  });
});
