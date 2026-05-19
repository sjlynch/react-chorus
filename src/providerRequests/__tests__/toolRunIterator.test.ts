import { describe, expect, it } from 'vitest';
import { forEachHistoryEntry } from '../toolRunIterator';
import type { Message } from '../../types';

function user(id: string, text = id): Message {
  return { id, role: 'user', text };
}

function assistant(id: string, text = id): Message {
  return { id, role: 'assistant', text };
}

function tool(id: string): Message {
  return { id, role: 'tool', text: '', toolCall: { name: 't', input: {}, output: id } };
}

type Visit =
  | { kind: 'message'; id: string }
  | { kind: 'run'; ids: string[] };

function collect(history: Message[]): Visit[] {
  const visits: Visit[] = [];
  forEachHistoryEntry(history, {
    onMessage: message => visits.push({ kind: 'message', id: message.id }),
    onToolRun: run => visits.push({ kind: 'run', ids: run.map(m => m.id) }),
  });
  return visits;
}

describe('forEachHistoryEntry', () => {
  it('passes non-tool messages through onMessage individually', () => {
    expect(collect([user('u1'), assistant('a1'), user('u2')])).toEqual([
      { kind: 'message', id: 'u1' },
      { kind: 'message', id: 'a1' },
      { kind: 'message', id: 'u2' },
    ]);
  });

  it('folds a contiguous tool run into a single onToolRun call', () => {
    expect(collect([assistant('a1'), tool('t1'), tool('t2'), tool('t3'), user('u1')])).toEqual([
      { kind: 'message', id: 'a1' },
      { kind: 'run', ids: ['t1', 't2', 't3'] },
      { kind: 'message', id: 'u1' },
    ]);
  });

  it('starts a new run after a non-tool message breaks the contiguous sequence', () => {
    expect(collect([tool('t1'), assistant('a1'), tool('t2')])).toEqual([
      { kind: 'run', ids: ['t1'] },
      { kind: 'message', id: 'a1' },
      { kind: 'run', ids: ['t2'] },
    ]);
  });

  it('handles a history that ends in a tool run', () => {
    expect(collect([user('u1'), tool('t1'), tool('t2')])).toEqual([
      { kind: 'message', id: 'u1' },
      { kind: 'run', ids: ['t1', 't2'] },
    ]);
  });

  it('emits nothing for empty history', () => {
    expect(collect([])).toEqual([]);
  });

  it('skips falsy entries without emitting callbacks for them', () => {
    const sparse = [user('u1'), undefined as unknown as Message, tool('t1')];
    expect(collect(sparse)).toEqual([
      { kind: 'message', id: 'u1' },
      { kind: 'run', ids: ['t1'] },
    ]);
  });
});
