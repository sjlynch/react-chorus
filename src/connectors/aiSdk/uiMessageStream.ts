import { extractErrorMessage } from '../error';
import type { ConnectorResult } from '../types';
import {
  type AiSdkConnectorState,
  hasOwn,
  resetAiSdkState,
  toolDeltaFromToolCall,
  toolDeltaFromToolResult,
} from './shared';

// Vercel AI SDK UI-message-stream `type` values that `aiSdkConnector` either
// parses or intentionally ignores. Exported so `autoConnector` can delegate
// every recognised frame to the AI SDK path without duplicating the list.
export const AI_SDK_FRAME_TYPES = new Set([
  // Parsed by uiMessageStreamResult.
  'text-delta',
  'text',
  'reasoning-delta',
  'reasoning',
  'tool-input-start',
  'tool-call-streaming-start',
  'tool-input-delta',
  'tool-call-delta',
  'tool-input-available',
  'tool-call',
  'tool-output-available',
  'tool-result',
  'error',
  'finish',
  'finish-message',
  // Intentionally ignored (lifecycle / non-text payloads) — still claimed so
  // autoConnector does not render them as raw protocol JSON.
  'start',
  'start-step',
  'finish-step',
  'text-start',
  'text-end',
  'reasoning-start',
  'reasoning-end',
  'source-url',
  'source-document',
  'file',
  'message-metadata',
]);

/**
 * True when `type` is a Vercel AI SDK UI-message-stream frame this connector
 * parses or intentionally ignores. `autoConnector` uses this so every AI SDK
 * frame (including data-`*` wildcards and lifecycle-only frames) is delegated
 * to the AI SDK path instead of falling through to raw-text rendering.
 */
export function isAiSdkFrameType(type: unknown): boolean {
  if (typeof type !== 'string') return false;
  return AI_SDK_FRAME_TYPES.has(type) || type.startsWith('data-');
}

export function uiMessageStreamResult(state: AiSdkConnectorState, obj: Record<string, unknown>, raw: unknown): ConnectorResult | null {
  const type = obj.type;
  if (typeof type !== 'string') return null;

  if (type === 'text-delta' || type === 'text') {
    const delta = obj.delta ?? obj.text;
    return typeof delta === 'string' && delta ? { text: delta } : null;
  }

  if (type === 'reasoning-delta' || type === 'reasoning') {
    const delta = obj.delta ?? obj.text;
    return typeof delta === 'string' && delta ? { reasoning: delta } : null;
  }

  if (type === 'tool-input-start' || type === 'tool-call-streaming-start') {
    const toolDelta = toolDeltaFromToolCall(state, type, obj.toolCallId, obj.toolName, undefined, false);
    return toolDelta ? { toolDelta } : null;
  }

  if (type === 'tool-input-delta' || type === 'tool-call-delta') {
    // Prefer the first non-empty alias: `??` only falls through on
    // null/undefined, so a mixed-alias frame like
    // `{inputTextDelta:'', argsTextDelta:'hi'}` would otherwise keep the empty
    // string and drop the real delta on the guard below.
    const fragment = (typeof obj.inputTextDelta === 'string' && obj.inputTextDelta)
      ? obj.inputTextDelta
      : obj.argsTextDelta;
    if (typeof fragment !== 'string' || fragment === '') return null;
    const toolDelta = toolDeltaFromToolCall(state, type, obj.toolCallId, obj.toolName, fragment, true);
    return toolDelta ? { toolDelta } : null;
  }

  if (type === 'tool-input-available' || type === 'tool-call') {
    const input = obj.input ?? obj.args;
    const hasArgs = hasOwn(obj, 'input') || hasOwn(obj, 'args');
    const toolDelta = toolDeltaFromToolCall(state, type, obj.toolCallId, obj.toolName, input, hasArgs);
    return toolDelta ? { toolDelta } : null;
  }

  if (type === 'tool-output-available' || type === 'tool-result') {
    const output = obj.output ?? obj.result;
    const hasOutput = hasOwn(obj, 'output') || hasOwn(obj, 'result');
    const toolDelta = toolDeltaFromToolResult(state, type, obj.toolCallId, output, hasOutput);
    return toolDelta ? { toolDelta } : null;
  }

  if (type === 'error') {
    const message = typeof obj.errorText === 'string' && obj.errorText
      ? obj.errorText
      : extractErrorMessage(obj) ?? 'AI SDK stream reported an error';
    return { error: message, errorPayload: raw };
  }

  if (type === 'finish' || type === 'finish-message') {
    resetAiSdkState(state);
    return { done: true };
  }

  // Frames we deliberately ignore: start, start-step, finish-step, text-start, text-end,
  // reasoning-start, reasoning-end, source-url, source-document, file, data-*, message-metadata.
  return null;
}
