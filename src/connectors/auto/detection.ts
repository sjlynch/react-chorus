import { isAiSdkFrameType } from '../aiSdk';
import { DATA_STREAM_PREFIX_PATTERN } from '../aiSdk/dataStream';

const KNOWN_ANTHROPIC_EVENT_TYPES = new Set([
  'message_start',
  'message_delta',
  'message_stop',
  'content_block_start',
  'content_block_delta',
  'content_block_stop',
  'ping',
  'error',
]);

// `isAiSdkFrameType` (re-exported from `aiSdk.ts`) lists every UI-message-stream
// `type` value `aiSdkConnector` parses or intentionally ignores (including
// alias frames such as `tool-call-streaming-start` / `tool-call-delta`, the
// `data-*` wildcard, and `message-metadata`). Dispatching on it keeps explicit
// `connector="ai-sdk"` and default `connector="auto"` in sync so AI SDK
// lifecycle frames never fall through to raw-text rendering.

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function hasOpenAIChatShape(value: unknown): boolean {
  return isObjectRecord(value) && Array.isArray(value.choices);
}

export function hasGeminiCandidateShape(value: unknown): boolean {
  return isObjectRecord(value) && Array.isArray(value.candidates);
}

export function hasOpenAIResponseShape(value: unknown): boolean {
  return isObjectRecord(value) && typeof value.type === 'string' && value.type.startsWith('response.');
}

export function hasAnthropicEventShape(value: unknown): boolean {
  return isObjectRecord(value) && typeof value.type === 'string' && KNOWN_ANTHROPIC_EVENT_TYPES.has(value.type);
}

export function hasAiSdkUiMessageShape(value: unknown): boolean {
  return isObjectRecord(value) && isAiSdkFrameType(value.type);
}

export function genericJSONText(obj: unknown): string | null {
  if (!isObjectRecord(obj)) return null;
  for (const key of ['text', 'content', 'delta']) {
    const value = obj[key];
    if (typeof value === 'string' && value) return value;
  }
  const delta = obj.delta;
  if (isObjectRecord(delta)) {
    for (const key of ['text', 'content']) {
      const value = delta[key];
      if (typeof value === 'string' && value) return value;
    }
  }
  return null;
}

/**
 * True when a non-JSON line is genuinely a Vercel AI SDK data-stream frame
 * (`0:"..."`, `9:{...}`, `e:{...}`) rather than plain model output that merely
 * begins with `[a-z0-9]:`.
 *
 * `connector="auto"` also serves plain-text streams, so the data-stream
 * dispatch must stay conservative:
 * - the line must match the `<prefix>:<rest>` shape, and
 * - `<rest>` must be valid JSON — prose like `a: example text` is not, so it
 *   falls through to plain-text rendering instead of being silently dropped, and
 * - for the `d:` / `e:` finish prefixes `<rest>` must be an object (the real
 *   finish-frame `{finishReason, usage}` shape) so a plain line such as `d:0`
 *   or `e:"note"` cannot terminate the stream early.
 *
 * An explicit `connector="ai-sdk"` opts into the protocol and needs no such
 * guard; this only tightens the auto path.
 */
export function isAutoDataStreamFrame(data: string): boolean {
  const match = DATA_STREAM_PREFIX_PATTERN.exec(data);
  if (!match) return false;
  const prefix = match[1];
  const rest = match[2];
  if (prefix === undefined || rest === undefined) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rest);
  } catch {
    return false;
  }
  if (prefix === 'd' || prefix === 'e') {
    return parsed !== null && typeof parsed === 'object';
  }
  return true;
}
