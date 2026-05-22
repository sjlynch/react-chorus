import { warnOnceInDev } from '../../utils/warnings';
import { hasOwn } from '../objectUtils';
import type { ConnectorResult, ConnectorToolDelta } from '../types';
import { extractUsage } from '../usage';

export { hasOwn };

export interface AiSdkConnectorState {
  toolNamesById: Map<string, string>;
}

export function createAiSdkConnectorState(): AiSdkConnectorState {
  return { toolNamesById: new Map<string, string>() };
}

export function resetAiSdkState(state: AiSdkConnectorState) {
  state.toolNamesById.clear();
}

export function warnMissingToolCallId(frameType: string) {
  warnOnceInDev(
    `ai-sdk:${frameType}:missing-toolCallId`,
    `[Chorus] AI SDK ${frameType} frame is missing required field \`toolCallId\`; the tool fragment was dropped. Ensure every tool frame includes a \`toolCallId\`.`,
  );
}

export function toolDeltaFromToolCall(
  state: AiSdkConnectorState,
  frameType: string,
  toolCallId: unknown,
  toolName: unknown,
  args: unknown,
  hasArgs: boolean,
): ConnectorToolDelta | null {
  const explicitId = typeof toolCallId === 'string' && toolCallId ? toolCallId : undefined;
  if (!explicitId) {
    warnMissingToolCallId(frameType);
    return null;
  }
  const name = typeof toolName === 'string' && toolName ? toolName : state.toolNamesById.get(explicitId);
  if (name) state.toolNamesById.set(explicitId, name);
  // Tag the delta with `provider: 'ai-sdk'` so `metadataWithToolProvider`
  // persists `providerId` into `metadata.aiSdk.toolCallId`. Without a provider
  // tag the captured tool-call id is silently dropped — see that helper.
  const delta: ConnectorToolDelta = { id: explicitId, providerId: explicitId, provider: 'ai-sdk' };
  if (name) delta.name = name;
  if (hasArgs) delta.input = args;
  return delta;
}

/**
 * Build the terminal `{ done: true }` result for an AI SDK finish frame.
 *
 * Both AI SDK terminal frames carry token usage and a finish reason — the v4
 * data-stream `d:` frame is `{ finishReason, usage }` and the v5 UI-message
 * `finish` / `finish-message` frame carries the same shape. Every other
 * connector surfaces `metadata.usage`, so the AI SDK connector matches by
 * routing the frame's `usage` through the shared `extractUsage` normalizer and
 * attaching `{ usage, finishReason }` alongside `done: true`. `metadata` is
 * omitted entirely when the frame carries neither, so a bare `{ type: 'finish' }`
 * still yields exactly `{ done: true }`.
 */
export function aiSdkFinishResult(usage: unknown, finishReason: unknown): ConnectorResult {
  const result: ConnectorResult = { done: true };
  const metadata: Record<string, unknown> = {};
  const normalizedUsage = extractUsage(usage);
  if (normalizedUsage) metadata.usage = normalizedUsage;
  if (typeof finishReason === 'string' && finishReason) metadata.finishReason = finishReason;
  if (Object.keys(metadata).length > 0) result.metadata = metadata;
  return result;
}

export function toolDeltaFromToolResult(
  state: AiSdkConnectorState,
  frameType: string,
  toolCallId: unknown,
  output: unknown,
  hasOutput: boolean,
): ConnectorToolDelta | null {
  const explicitId = typeof toolCallId === 'string' && toolCallId ? toolCallId : undefined;
  if (!explicitId) {
    warnMissingToolCallId(frameType);
    return null;
  }
  const delta: ConnectorToolDelta = { id: explicitId, providerId: explicitId, provider: 'ai-sdk' };
  // Only set `output` when the frame actually carried an `output`/`result`
  // key. A malformed `tool-output-available` / `a:` frame with neither key
  // would otherwise emit `{ output: undefined }`, which downstream reads as
  // "tool finished with an undefined result" — prematurely closing a tool row
  // still mid-execution. Mirrors the `hasArgs` guard in `toolDeltaFromToolCall`.
  if (hasOutput) delta.output = output;
  const name = state.toolNamesById.get(explicitId);
  if (name) delta.name = name;
  return delta;
}
