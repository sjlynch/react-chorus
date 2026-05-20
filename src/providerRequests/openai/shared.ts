import type { Message } from '../../types';
import { isRecord, metadataString } from '../metadata';
import { compactJSONString } from '../toolOutput';

// Local dev gate + warn-once cache. Duplicated from utils/warnings.ts so the
// provider-requests subpath stays standalone (server-friendly, no shared utils
// chunk). Same pattern as attachments.ts — see src/utils/CLAUDE.md.
const warnedKeys = new Set<string>();
function warnOnceInDev(key: string, message: string): void {
  if (typeof process === 'undefined' || typeof process.env === 'undefined') return;
  if (process.env.NODE_ENV === 'production') return;
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(message);
}

export function openAIToolCallId(message: Message<unknown>) {
  return metadataString(message, 'openai', ['toolCallId', 'tool_call_id', 'callId', 'call_id'], [
    'openaiToolCallId',
    'openai_tool_call_id',
    'toolCallId',
    'tool_call_id',
    'callId',
    'call_id',
    'providerToolCallId',
  ]);
}

/**
 * Serialize a tool call's `input` into a JSON string for an OpenAI tool call's
 * `arguments` field. Chat Completions `tool_calls[].function.arguments` and
 * Responses `function_call.arguments` are both required to be JSON-encoded.
 *
 * `compactJSONString` returns string input verbatim, so a plain (non-JSON)
 * string would otherwise become bare, invalid JSON in the request body. Here a
 * string is passed through only when it already encodes a JSON object or array;
 * otherwise it is wrapped as `{ "input": "<text>" }` — mirroring how
 * `objectToolInput` normalizes the same value for Gemini and Anthropic.
 */
export function openAIToolCallArguments(input: unknown): string {
  if (typeof input === 'string') {
    try {
      const parsed: unknown = JSON.parse(input);
      if (isRecord(parsed) || Array.isArray(parsed)) return input;
    } catch {
      // Not JSON — fall through and wrap below.
    }
    return JSON.stringify({ input });
  }
  return compactJSONString(input ?? {});
}

/**
 * Resolve the OpenAI tool-call id for a tool message.
 *
 * Prefers the provider id carried in metadata. When none is present, returns a
 * deterministic best-effort id synthesized from the message id so the assistant
 * tool call survives as a structured `function_call` / `tool_calls` entry
 * instead of being silently dropped (or degraded to prose). OpenAI only
 * requires the call and its paired output to share a `call_id` within a single
 * request, so a synthesized id is safe; a dev-mode warning keeps the missing
 * metadata observable.
 */
export function resolveOpenAIToolCallId(message: Message<unknown>): string {
  const id = openAIToolCallId(message);
  if (id) return id;
  const synthesized = `chorus_synth_${message.id}`;
  warnOnceInDev(
    `react-chorus:openai-tool-call-id:${message.id}`,
    `[react-chorus] OpenAI tool message "${message.id}" has no tool-call id in metadata; `
      + `synthesized a best-effort id ("${synthesized}") so the tool call is preserved. `
      + `Set metadata.openai.toolCallId (or tool_call_id) to the provider's id.`,
  );
  return synthesized;
}
