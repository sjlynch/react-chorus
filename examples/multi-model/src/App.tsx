import React from 'react';
import 'react-chorus/styles.css';
import { Chorus } from 'react-chorus';
import type { ChorusRef, Message, Transport } from 'react-chorus';

/**
 * Composability example: one shared composer fans out the same prompt to N
 * independent <Chorus> instances, each running a different provider. The
 * parent owns the draft + suggested-prompts + "Pick winner" action; the
 * children are each a stock <Chorus> driven through the imperative ref.
 *
 * No library-core changes — this is built entirely on existing public APIs
 * (`transport`, `value`/`onChange`, `ref.send`, `ref.stop`). When the
 * branching-DAG and parallel-sibling-streaming tasks land, this example
 * becomes the design template for a single-conversation `<MultiChorus>`
 * library export.
 */

const mockOpenAITransport: Transport = (text, _history, signal) =>
  Promise.resolve(streamFrames(buildOpenAIFrames(text), signal));

const mockAnthropicTransport: Transport = (text, _history, signal) =>
  Promise.resolve(streamFrames(buildAnthropicFrames(text), signal));

const mockGeminiTransport: Transport = (text, _history, signal) =>
  Promise.resolve(streamFrames(buildGeminiFrames(text), signal));

function buildOpenAIFrames(text: string): string[] {
  const reply = `gpt-4o-mini would answer: ${text.slice(0, 140)}`;
  return [
    ...reply.split(' ').map((word, i) =>
      JSON.stringify({
        choices: [{ index: 0, delta: { content: i === 0 ? word : ` ${word}` } }],
      }),
    ),
    '[DONE]',
  ];
}

function buildAnthropicFrames(text: string): string[] {
  const reply = `Claude (anthropic) reply — ${text.slice(0, 140)}`;
  return [
    ...reply.split(' ').map((word, i) =>
      JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: i === 0 ? word : ` ${word}` },
      }),
    ),
    JSON.stringify({ type: 'message_stop' }),
  ];
}

function buildGeminiFrames(text: string): string[] {
  const reply = `Gemini draft: ${text.slice(0, 140)}`;
  const words = reply.split(' ');
  return words.map((word, i) => {
    const part = { text: i === 0 ? word : ` ${word}` };
    const candidate: Record<string, unknown> = { index: 0, content: { parts: [part] } };
    if (i === words.length - 1) candidate.finishReason = 'STOP';
    return JSON.stringify({ candidates: [candidate] });
  });
}

function streamFrames(frames: string[], signal: AbortSignal): Response {
  // Each column gets its own jitter so the three streams visibly race.
  const baseDelay = 25 + Math.random() * 35;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      for (const frame of frames) {
        if (signal.aborted) {
          controller.close();
          return;
        }
        await new Promise(resolve => setTimeout(resolve, baseDelay + Math.random() * 30));
        controller.enqueue(encoder.encode(`data: ${frame}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}

interface ColumnConfig {
  id: string;
  label: string;
  modelId: string;
  connector: 'openai' | 'anthropic' | 'gemini';
  transport: Transport;
  accent: string;
}

const COLUMNS: ColumnConfig[] = [
  { id: 'openai', label: 'OpenAI', modelId: 'gpt-4o-mini', connector: 'openai', transport: mockOpenAITransport, accent: '#10a37f' },
  { id: 'anthropic', label: 'Claude', modelId: 'claude-3-5-sonnet', connector: 'anthropic', transport: mockAnthropicTransport, accent: '#cc785c' },
  { id: 'gemini', label: 'Gemini', modelId: 'gemini-2.5-flash', connector: 'gemini', transport: mockGeminiTransport, accent: '#4285f4' },
];

const SUGGESTIONS = [
  'Write a one-line haiku about debugging.',
  'Explain TCP slow start in two sentences.',
  'Coin a startup name for an AI dishwasher.',
];

type MessagesByColumn = Record<string, Message[]>;

const initialMessagesByColumn = (): MessagesByColumn =>
  Object.fromEntries(COLUMNS.map(c => [c.id, [] as Message[]]));

export default function App() {
  const [draft, setDraft] = React.useState('');
  const [winner, setWinner] = React.useState<string | null>(null);
  const [messagesByColumn, setMessagesByColumn] = React.useState<MessagesByColumn>(initialMessagesByColumn);
  const [streamingByColumn, setStreamingByColumn] = React.useState<Record<string, boolean>>({});
  const refs = React.useRef<Record<string, ChorusRef | null>>({});

  const anyStreaming = Object.values(streamingByColumn).some(Boolean);
  const allColumnsAnswered =
    COLUMNS.every(c => {
      const msgs = messagesByColumn[c.id] ?? [];
      const last = msgs[msgs.length - 1];
      return !!last && last.role === 'assistant';
    });
  const canPickWinner = !winner && !anyStreaming && allColumnsAnswered;

  const submit = React.useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    const accepted: Record<string, boolean> = {};
    for (const col of COLUMNS) {
      if (winner && winner !== col.id) continue;
      accepted[col.id] = refs.current[col.id]?.send(text) === true;
    }
    setStreamingByColumn(s => {
      const next = { ...s };
      for (const id of Object.keys(accepted)) {
        if (accepted[id]) next[id] = true;
      }
      return next;
    });
    setDraft('');
  }, [draft, winner]);

  const stopAll = React.useCallback(() => {
    for (const col of COLUMNS) refs.current[col.id]?.stop();
  }, []);

  const pickWinner = React.useCallback((id: string) => {
    setMessagesByColumn(prev => {
      const next: MessagesByColumn = { ...prev };
      for (const col of COLUMNS) {
        if (col.id === id) continue;
        next[col.id] = dropLastTurn(prev[col.id] ?? []);
      }
      return next;
    });
    setWinner(id);
  }, []);

  const reset = React.useCallback(() => {
    setMessagesByColumn(initialMessagesByColumn());
    setWinner(null);
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div style={shellStyle}>
      <style>{`.chorus-multi-column .chorus-input { display: none; }`}</style>

      <header style={headerStyle}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Multi-model side-by-side</div>
          <div style={{ opacity: 0.6, fontSize: 12 }}>
            One prompt fans out to {COLUMNS.length} providers. Pick a winner to mark a column
            canonical and roll back the others' last turn.
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {winner && (
          <span style={{ fontSize: 12, opacity: 0.7 }}>
            Winner: <strong style={{ color: COLUMNS.find(c => c.id === winner)?.accent }}>
              {COLUMNS.find(c => c.id === winner)?.label}
            </strong>
          </span>
        )}
        <button type="button" onClick={reset} style={btnStyle()}>Reset all</button>
      </header>

      <div
        style={{
          ...gridStyle,
          gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(0, 1fr))`,
        }}
      >
        {COLUMNS.map(col => {
          const isWinner = winner === col.id;
          const isLoser = winner != null && !isWinner;
          return (
            <section
              key={col.id}
              className="chorus-multi-column"
              style={{
                ...columnStyle,
                borderColor: isWinner ? col.accent : '#1f1f1f',
                boxShadow: isWinner ? `0 0 0 2px ${col.accent}33` : undefined,
                opacity: isLoser ? 0.55 : 1,
              }}
            >
              <div style={columnHeaderStyle}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: col.accent }} />
                <strong>{col.label}</strong>
                <span style={{ opacity: 0.55, fontSize: 12 }}>{col.modelId}</span>
                <span style={{ flex: 1 }} />
                {isWinner && <span style={{ fontSize: 12, color: col.accent, fontWeight: 600 }}>★ Winner</span>}
                {!winner && (
                  <button
                    type="button"
                    disabled={!canPickWinner}
                    onClick={() => pickWinner(col.id)}
                    title={canPickWinner
                      ? "Mark canonical; roll back the other columns' last turn."
                      : 'Wait for every column to finish a reply first.'}
                    style={btnStyle(canPickWinner ? col.accent : undefined)}
                  >
                    Pick winner
                  </button>
                )}
              </div>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <Chorus
                  ref={r => { refs.current[col.id] = r; }}
                  transport={col.transport}
                  connector={col.connector}
                  modelId={col.modelId}
                  value={messagesByColumn[col.id]}
                  onChange={msgs => {
                    setMessagesByColumn(prev =>
                      prev[col.id] === msgs ? prev : { ...prev, [col.id]: msgs },
                    );
                  }}
                  onFinish={() => setStreamingByColumn(s => ({ ...s, [col.id]: false }))}
                  onAbort={() => setStreamingByColumn(s => ({ ...s, [col.id]: false }))}
                  onError={() => setStreamingByColumn(s => ({ ...s, [col.id]: false }))}
                  onChunk={() => {
                    setStreamingByColumn(s => (s[col.id] ? s : { ...s, [col.id]: true }));
                  }}
                  emptyState={
                    <div style={{ padding: 16, opacity: 0.55, fontSize: 13 }}>
                      No turns yet. Use the composer below to fan a prompt out to every column.
                    </div>
                  }
                  placeholder="(composer disabled — parent owns the input)"
                />
              </div>
            </section>
          );
        })}
      </div>

      <footer style={footerStyle}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {SUGGESTIONS.map(prompt => (
            <button
              key={prompt}
              type="button"
              onClick={() => setDraft(prompt)}
              style={chipStyle}
            >
              {prompt}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder={winner
              ? `Continue with ${COLUMNS.find(c => c.id === winner)?.label} only — other columns are paused.`
              : `Send one prompt to every model. Enter to submit, Shift+Enter for newline.`}
            style={textareaStyle}
          />
          {anyStreaming ? (
            <button type="button" onClick={stopAll} style={btnStyle('#ef4444')}>Stop all</button>
          ) : (
            <button type="button" onClick={submit} disabled={!draft.trim()} style={btnStyle('#3b82f6')}>
              Send
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

// "Pick winner" archives the losers' last turn: drop everything from the last
// user message onward, restoring the column to its pre-prompt state.
function dropLastTurn(msgs: Message[]): Message[] {
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    if (msgs[i].role === 'user') return msgs.slice(0, i);
  }
  return msgs;
}

const shellStyle: React.CSSProperties = {
  height: '100dvh',
  display: 'flex',
  flexDirection: 'column',
  background: '#0f0f0f',
  color: '#e5e5e5',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 16px',
  borderBottom: '1px solid #1f1f1f',
};

const gridStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gap: 8,
  padding: 8,
};

const columnStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid #1f1f1f',
  borderRadius: 8,
  background: '#121212',
  transition: 'opacity 0.2s, box-shadow 0.2s, border-color 0.2s',
};

const columnHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderBottom: '1px solid #1f1f1f',
};

const footerStyle: React.CSSProperties = {
  borderTop: '1px solid #1f1f1f',
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  background: '#0f0f0f',
};

const textareaStyle: React.CSSProperties = {
  flex: 1,
  padding: 10,
  borderRadius: 6,
  border: '1px solid #2a2a2a',
  background: '#1a1a1a',
  color: '#e5e5e5',
  font: 'inherit',
  resize: 'vertical',
  minHeight: 44,
};

const chipStyle: React.CSSProperties = {
  background: '#1a1a1a',
  border: '1px solid #2a2a2a',
  color: '#bbb',
  padding: '4px 10px',
  borderRadius: 999,
  cursor: 'pointer',
  fontSize: 12,
};

function btnStyle(accent?: string): React.CSSProperties {
  return {
    border: 'none',
    background: accent ?? '#2a2a2a',
    color: '#fff',
    padding: '6px 12px',
    borderRadius: 6,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: 13,
    opacity: 1,
  };
}
