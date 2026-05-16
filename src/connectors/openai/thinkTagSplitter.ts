import type { ConnectorResult } from '../types';

const THINK_START = '<think>';
const THINK_END = '</think>';

export interface ThinkTagSplitterState {
  inThink: boolean;
  buffer: string;
}

export function createThinkTagSplitterState(): ThinkTagSplitterState {
  return { inThink: false, buffer: '' };
}

function appendField(target: Pick<ConnectorResult, 'text' | 'reasoning'>, key: 'text' | 'reasoning', value: string) {
  if (!value) return;
  target[key] = `${target[key] ?? ''}${value}`;
}

function trailingPartialTagLength(value: string, tag: string) {
  const max = Math.min(tag.length - 1, value.length);
  for (let len = max; len > 0; len -= 1) {
    if (tag.startsWith(value.slice(-len))) return len;
  }
  return 0;
}

export function createThinkTagSplitter(state = createThinkTagSplitterState()) {
  const feed = (chunk: string) => {
    let source = state.buffer + chunk;
    state.buffer = '';
    const result: Pick<ConnectorResult, 'text' | 'reasoning'> = {};

    while (source) {
      if (state.inThink) {
        const end = source.indexOf(THINK_END);
        if (end === -1) {
          const keep = trailingPartialTagLength(source, THINK_END);
          const emit = keep > 0 ? source.slice(0, -keep) : source;
          appendField(result, 'reasoning', emit);
          state.buffer = keep > 0 ? source.slice(-keep) : '';
          source = '';
        } else {
          appendField(result, 'reasoning', source.slice(0, end));
          source = source.slice(end + THINK_END.length);
          state.inThink = false;
        }
      } else {
        const start = source.indexOf(THINK_START);
        if (start === -1) {
          const keep = trailingPartialTagLength(source, THINK_START);
          const emit = keep > 0 ? source.slice(0, -keep) : source;
          appendField(result, 'text', emit);
          state.buffer = keep > 0 ? source.slice(-keep) : '';
          source = '';
        } else {
          appendField(result, 'text', source.slice(0, start));
          source = source.slice(start + THINK_START.length);
          state.inThink = true;
        }
      }
    }

    return result;
  };

  const flush = () => {
    const result: Pick<ConnectorResult, 'text' | 'reasoning'> = {};
    if (state.buffer) appendField(result, state.inThink ? 'reasoning' : 'text', state.buffer);
    state.inThink = false;
    state.buffer = '';
    return result;
  };

  const reset = () => {
    state.inThink = false;
    state.buffer = '';
  };

  return { feed, flush, reset };
}
