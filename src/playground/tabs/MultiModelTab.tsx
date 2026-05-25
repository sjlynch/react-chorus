import React from 'react';
import { Chorus } from '../../Chorus';
import type { ChorusRef } from '../../Chorus';
import type { Message } from '../../types';
import { DEMO_PALETTE } from './palettes';
import { mockAnthropicTransport, mockGeminiTransport, mockOpenAITransport } from './multiProviderTransport';

interface ColumnSpec {
  id: 'openai' | 'anthropic' | 'gemini';
  label: string;
  modelId: string;
  connector: 'openai' | 'anthropic' | 'gemini';
  transport: typeof mockOpenAITransport;
  badge: string;
}

const COLUMNS: ColumnSpec[] = [
  { id: 'openai', label: 'OpenAI', modelId: 'gpt-4o-mini', connector: 'openai', transport: mockOpenAITransport, badge: '#10a37f' },
  { id: 'anthropic', label: 'Claude', modelId: 'claude-3-5-sonnet', connector: 'anthropic', transport: mockAnthropicTransport, badge: '#c97064' },
  { id: 'gemini', label: 'Gemini', modelId: 'gemini-2.5-flash', connector: 'gemini', transport: mockGeminiTransport, badge: '#4285f4' },
];

const LEDE = "Type once below — the shared composer fans the prompt to all three columns in parallel. Each column is its own <Chorus> driven through ref.send, with the built-in composer hidden by CSS. After every column finishes, click ★ winner to pick one as canonical: the other columns roll back their last turn and future sends go only to the winner. Reset all re-enables fan-out.";

interface ColumnState {
  messages: Message[];
  streaming: boolean;
}

type ColumnsState = Record<ColumnSpec['id'], ColumnState>;

function emptyState(): ColumnsState {
  return COLUMNS.reduce<ColumnsState>((acc, col) => {
    acc[col.id] = { messages: [], streaming: false };
    return acc;
  }, {} as ColumnsState);
}

function trimAfterLastUser(messages: Message[]): Message[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages.slice(0, i);
  }
  return messages;
}

export function MultiModelTab() {
  const openaiRef = React.useRef<ChorusRef>(null);
  const anthropicRef = React.useRef<ChorusRef>(null);
  const geminiRef = React.useRef<ChorusRef>(null);
  const refs = React.useMemo(
    () => ({ openai: openaiRef, anthropic: anthropicRef, gemini: geminiRef }),
    [],
  );
  const [draft, setDraft] = React.useState('');
  const [winnerId, setWinnerId] = React.useState<ColumnSpec['id'] | null>(null);
  const [state, setState] = React.useState<ColumnsState>(() => emptyState());

  const someoneSending = COLUMNS.some(col => state[col.id].streaming);
  const everyoneReplied = COLUMNS.every(col => {
    const msgs = state[col.id].messages;
    return msgs.length > 0 && msgs.at(-1)?.role === 'assistant';
  });
  const canPickWinner = !winnerId && !someoneSending && everyoneReplied;

  const send = React.useCallback(() => {
    const text = draft.trim();
    if (!text || someoneSending) return;
    const targets: ColumnSpec['id'][] = winnerId ? [winnerId] : COLUMNS.map(c => c.id);
    targets.forEach(id => refs[id].current?.send(text));
    setDraft('');
  }, [draft, someoneSending, winnerId, refs]);

  const stop = React.useCallback(() => {
    COLUMNS.forEach(col => refs[col.id].current?.stop());
  }, [refs]);

  const resetAll = React.useCallback(() => {
    COLUMNS.forEach(col => refs[col.id].current?.clear());
    setWinnerId(null);
    setState(emptyState());
  }, [refs]);

  const pickWinner = React.useCallback((id: ColumnSpec['id']) => {
    setWinnerId(id);
    setState(prev => {
      const next = { ...prev };
      COLUMNS.forEach(col => {
        if (col.id !== id) next[col.id] = { ...next[col.id], messages: trimAfterLastUser(next[col.id].messages) };
      });
      return next;
    });
  }, []);

  const onColumnChange = React.useCallback((id: ColumnSpec['id']) => (messages: Message[]) => {
    setState(prev => ({ ...prev, [id]: { ...prev[id], messages } }));
  }, []);

  const onColumnSending = React.useCallback((id: ColumnSpec['id'], streaming: boolean) => {
    setState(prev => ({ ...prev, [id]: { ...prev[id], streaming } }));
  }, []);

  return (
    <div className="pg-multimodel">
      <p className="pg-multimodel-lede">{LEDE}</p>

      <div className="pg-multimodel-grid">
        {COLUMNS.map(col => {
          const isWinner = winnerId === col.id;
          const isLoser = winnerId !== null && !isWinner;
          return (
            <div
              key={col.id}
              className={`pg-multimodel-col ${isWinner ? 'pg-multimodel-col--winner' : ''} ${isLoser ? 'pg-multimodel-col--loser' : ''}`}
            >
              <header className="pg-multimodel-col-head">
                <span className="pg-multimodel-badge" style={{ background: col.badge }}>{col.label[0]}</span>
                <span className="pg-multimodel-col-label">{col.label}</span>
                <span className="pg-multimodel-col-model">{col.modelId}</span>
                {isWinner && <span className="pg-multimodel-winner-tag">★ winner</span>}
              </header>
              <div className="pg-multimodel-col-body">
                <Chorus
                  ref={refs[col.id]}
                  transport={col.transport}
                  connector={col.connector}
                  value={state[col.id].messages}
                  onChange={onColumnChange(col.id)}
                  onFinish={() => onColumnSending(col.id, false)}
                  onAbort={() => onColumnSending(col.id, false)}
                  onError={() => onColumnSending(col.id, false)}
                  onChunk={() => { if (!state[col.id].streaming) onColumnSending(col.id, true); }}
                  modelId={col.modelId}
                  palette={DEMO_PALETTE}
                />
              </div>
              {canPickWinner && (
                <button type="button" className="pg-multimodel-pick" onClick={() => pickWinner(col.id)}>
                  ★ Pick {col.label}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="pg-multimodel-composer">
        <textarea
          className="pg-multimodel-textarea"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={winnerId ? `Only ${COLUMNS.find(c => c.id === winnerId)?.label} gets new turns…` : 'Fan one prompt out to all three providers…'}
          rows={2}
        />
        <div className="pg-multimodel-composer-actions">
          {someoneSending ? (
            <button type="button" className="pg-multimodel-btn pg-multimodel-btn--stop" onClick={stop}>Stop all</button>
          ) : (
            <button type="button" className="pg-multimodel-btn pg-multimodel-btn--send" onClick={send} disabled={!draft.trim()}>Send</button>
          )}
          <button type="button" className="pg-multimodel-btn" onClick={resetAll}>Reset all</button>
        </div>
      </div>
    </div>
  );
}
