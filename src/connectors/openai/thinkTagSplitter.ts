import type { ConnectorResult } from '../types';

const DEFAULT_START = '<think>';
const DEFAULT_END = '</think>';

export interface ThinkTagSplitterOptions {
  /** Opening reasoning tag. Default `<think>`. */
  start?: string;
  /** Closing reasoning tag. Default `</think>`. */
  end?: string;
  /** Match the tag pair case-insensitively. Default `true`. */
  caseInsensitive?: boolean;
}

export interface ThinkTagSplitterState {
  inThink: boolean;
  buffer: string;
}

interface CompiledTag {
  literal: string;
  regex: RegExp;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileTag(tag: string, caseInsensitive: boolean): CompiledTag {
  const flags = caseInsensitive ? 'gi' : 'g';
  // For tags shaped like <name> or </name>, allow extra whitespace inside the
  // angle brackets (e.g. `< think >`). Any other custom delimiter is matched
  // literally so callers retain full control when the default heuristic does
  // not fit.
  const m = tag.match(/^<(\/?)\s*([^<>/\s][^<>\s]*)\s*>$/);
  if (m) {
    const [, slash, name] = m;
    if (name !== undefined) {
      return { literal: tag, regex: new RegExp(`<${slash ?? ''}\\s*${escapeRegex(name)}\\s*>`, flags) };
    }
  }
  return { literal: tag, regex: new RegExp(escapeRegex(tag), flags) };
}

export function createThinkTagSplitterState(): ThinkTagSplitterState {
  return { inThink: false, buffer: '' };
}

function appendField(target: Pick<ConnectorResult, 'text' | 'reasoning'>, key: 'text' | 'reasoning', value: string) {
  if (!value) return;
  target[key] = `${target[key] ?? ''}${value}`;
}

function trailingPartialTagLength(value: string, tag: string, caseInsensitive: boolean) {
  const cmpValue = caseInsensitive ? value.toLowerCase() : value;
  const cmpTag = caseInsensitive ? tag.toLowerCase() : tag;
  const max = Math.min(cmpTag.length - 1, cmpValue.length);
  for (let len = max; len > 0; len -= 1) {
    if (cmpTag.startsWith(cmpValue.slice(-len))) return len;
  }
  return 0;
}

function findFirstMatch(source: string, compiled: CompiledTag): { index: number; length: number } | null {
  compiled.regex.lastIndex = 0;
  const m = compiled.regex.exec(source);
  return m ? { index: m.index, length: m[0].length } : null;
}

export function createThinkTagSplitter(
  state: ThinkTagSplitterState = createThinkTagSplitterState(),
  options: ThinkTagSplitterOptions = {},
) {
  const caseInsensitive = options.caseInsensitive !== false;
  const startTag = compileTag(options.start ?? DEFAULT_START, caseInsensitive);
  const endTag = compileTag(options.end ?? DEFAULT_END, caseInsensitive);

  const feed = (chunk: string) => {
    let source = state.buffer + chunk;
    state.buffer = '';
    const result: Pick<ConnectorResult, 'text' | 'reasoning'> = {};

    while (source) {
      if (state.inThink) {
        const match = findFirstMatch(source, endTag);
        if (!match) {
          const keep = trailingPartialTagLength(source, endTag.literal, caseInsensitive);
          const emit = keep > 0 ? source.slice(0, -keep) : source;
          appendField(result, 'reasoning', emit);
          state.buffer = keep > 0 ? source.slice(-keep) : '';
          source = '';
        } else {
          appendField(result, 'reasoning', source.slice(0, match.index));
          source = source.slice(match.index + match.length);
          state.inThink = false;
        }
      } else {
        const match = findFirstMatch(source, startTag);
        if (!match) {
          const keep = trailingPartialTagLength(source, startTag.literal, caseInsensitive);
          const emit = keep > 0 ? source.slice(0, -keep) : source;
          appendField(result, 'text', emit);
          state.buffer = keep > 0 ? source.slice(-keep) : '';
          source = '';
        } else {
          appendField(result, 'text', source.slice(0, match.index));
          source = source.slice(match.index + match.length);
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
