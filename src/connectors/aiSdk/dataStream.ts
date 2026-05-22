import type { ConnectorResult } from '../types';
import {
  type AiSdkConnectorState,
  aiSdkFinishResult,
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
      // Preserve the original `3:` frame line as `errorPayload` so an `onError`
      // handler can identify the data-stream protocol and inspect the raw
      // line, matching the full-payload `errorPayload` of the other connectors
      // (a bare `parsed` string would just duplicate `message`).
      return { error: message, errorPayload: data };
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
      // Prefer the first non-empty alias: `??` only falls through on
      // null/undefined, so a mixed-alias frame like
      // `{argsTextDelta:'', inputTextDelta:'hi'}` would otherwise keep the
      // empty string and drop the real delta on the guard below.
      const fragment = (typeof record.argsTextDelta === 'string' && record.argsTextDelta)
        ? record.argsTextDelta
        : record.inputTextDelta;
      if (typeof fragment !== 'string' || fragment === '') return null;
      const toolDelta = toolDeltaFromToolCall(state, 'c:', record.toolCallId, undefined, fragment, true);
      return toolDelta ? { toolDelta } : null;
    }
    case 'a': {
      if (!parsed || typeof parsed !== 'object') return null;
      const record = parsed as Record<string, unknown>;
      const output = record.result ?? record.output;
      const hasOutput = hasOwn(record, 'result') || hasOwn(record, 'output');
      const toolDelta = toolDeltaFromToolResult(state, 'a:', record.toolCallId, output, hasOutput);
      return toolDelta ? { toolDelta } : null;
    }
    case 'd': {
      // `d:` is the finish-*message* part — the end of the whole HTTP stream.
      // It carries the v4 `{ finishReason, usage }` payload; surface both as
      // metadata so usage telemetry matches the other connectors.
      const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
      const result = aiSdkFinishResult(record.usage, record.finishReason);
      resetAiSdkState(state);
      return result;
    }
    case 'e':
      // `e:` is the finish-*step* part — it ends one step of a multi-step run
      // (e.g. between a tool call and the model's follow-up turn) while the
      // HTTP stream keeps flowing. Recognised explicitly and dropped (returns
      // null), matching the `finish-step` handling in uiMessageStream.ts.
      // Unlike `d:` it must NOT reset state or signal `done`, or a `streamText`
      // agent with `maxSteps > 1` would be cut off after its first step.
      return null;
    // Ignored: 1 (data), 2 (data array), 7/8 (annotations), f (start-step),
    // h (reasoning signature), i (redacted reasoning), j (source).
    default:
      return null;
  }
}
