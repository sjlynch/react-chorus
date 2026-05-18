import { warnOnceInDev } from '../../utils/warnings';
import type { ConnectorToolDelta } from '../types';

export interface AiSdkConnectorState {
  toolNamesById: Map<string, string>;
}

export function createAiSdkConnectorState(): AiSdkConnectorState {
  return { toolNamesById: new Map<string, string>() };
}

export function resetAiSdkState(state: AiSdkConnectorState) {
  state.toolNamesById.clear();
}

export function hasOwn(value: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
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
): ConnectorToolDelta | null {
  const explicitId = typeof toolCallId === 'string' && toolCallId ? toolCallId : undefined;
  if (!explicitId) {
    warnMissingToolCallId(frameType);
    return null;
  }
  const delta: ConnectorToolDelta = { id: explicitId, providerId: explicitId, output };
  const name = state.toolNamesById.get(explicitId);
  if (name) delta.name = name;
  return delta;
}
