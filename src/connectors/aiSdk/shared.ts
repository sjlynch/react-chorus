import { warnOnceInDev } from '../../utils/warnings';
import { hasOwn } from '../objectUtils';
import type { ConnectorToolDelta } from '../types';

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
  const delta: ConnectorToolDelta = { id: explicitId, providerId: explicitId };
  if (name) delta.name = name;
  if (hasArgs) delta.input = args;
  return delta;
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
  const delta: ConnectorToolDelta = { id: explicitId, providerId: explicitId };
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
