import type { ConnectorResult } from '../types';
import {
  type AiSdkConnectorState,
  hasOwn,
  resetAiSdkState,
  toolDeltaFromToolCall,
  toolDeltaFromToolResult,
} from './shared';

export const DATA_STREAM_PREFIX_PATTERN = /^([0-9a-z]):(.*)$/s;

export function dataStreamProtocolResult(state: AiSdkConnectorState, data: string): ConnectorResult | null {
  const match = DATA_STREAM_PREFIX_PATTERN.exec(data);
  if (!match) return null;
  const [, prefix, rest] = match;
  if (prefix === undefined || rest === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rest);
  } catch {
    return null;
  }

  switch (prefix) {
    case '0':
      return typeof parsed === 'string' && parsed ? { text: parsed } : null;
    case 'g':
      return typeof parsed === 'string' && parsed ? { reasoning: parsed } : null;
    case '3': {
      const message = typeof parsed === 'string' && parsed ? parsed : 'AI SDK stream reported an error';
      return { error: message, errorPayload: parsed };
    }
    case '9': {
      if (!parsed || typeof parsed !== 'object') return null;
      const record = parsed as Record<string, unknown>;
      const hasArgs = hasOwn(record, 'args') || hasOwn(record, 'input');
      const args = record.args ?? record.input;
      const toolDelta = toolDeltaFromToolCall(state, '9:', record.toolCallId, record.toolName, args, hasArgs);
      return toolDelta ? { toolDelta } : null;
    }
    case 'b': {
      if (!parsed || typeof parsed !== 'object') return null;
      const record = parsed as Record<string, unknown>;
      const toolDelta = toolDeltaFromToolCall(state, 'b:', record.toolCallId, record.toolName, undefined, false);
      return toolDelta ? { toolDelta } : null;
    }
    case 'c': {
      if (!parsed || typeof parsed !== 'object') return null;
      const record = parsed as Record<string, unknown>;
      const fragment = record.argsTextDelta ?? record.inputTextDelta;
      if (typeof fragment !== 'string' || fragment === '') return null;
      const toolDelta = toolDeltaFromToolCall(state, 'c:', record.toolCallId, undefined, fragment, true);
      return toolDelta ? { toolDelta } : null;
    }
    case 'a': {
      if (!parsed || typeof parsed !== 'object') return null;
      const record = parsed as Record<string, unknown>;
      const output = record.result ?? record.output;
      const toolDelta = toolDeltaFromToolResult(state, 'a:', record.toolCallId, output);
      return toolDelta ? { toolDelta } : null;
    }
    case 'd':
    case 'e':
      resetAiSdkState(state);
      return { done: true };
    // Ignored: 1 (data), 2 (data array), 7/8 (annotations), f (start-step),
    // h (reasoning signature), i (redacted reasoning), j (source).
    default:
      return null;
  }
}
