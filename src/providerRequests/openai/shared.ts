import type { Message } from '../../types';
import { isRecord, metadataString } from '../metadata';
import { compactJSONString } from '../toolOutput';

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
