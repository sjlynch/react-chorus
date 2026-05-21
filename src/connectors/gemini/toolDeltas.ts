import { hasOwn } from '../objectUtils';
import type { ConnectorToolDelta } from '../types';
import { resolveFunctionCallId, type GeminiConnectorState } from './state';

export function extractFunctionCallToolDelta(
  part: Record<string, unknown>,
  candidateKey: string,
  partIndex: number,
  state: GeminiConnectorState,
): ConnectorToolDelta | null {
  const functionCall = part.functionCall;
  if (!functionCall || typeof functionCall !== 'object') return null;
  const call = functionCall as Record<string, unknown>;
  const name = typeof call.name === 'string' && call.name ? call.name : undefined;
  const explicitId = typeof call.id === 'string' && call.id ? call.id : undefined;
  const resolved = resolveFunctionCallId(state, candidateKey, partIndex, explicitId, name);
  const toolDelta: ConnectorToolDelta = { id: resolved.id, provider: 'gemini' };
  if (resolved.fromProvider) toolDelta.providerId = resolved.id;
  else toolDelta.generated = true;
  if (name) toolDelta.name = name;
  if (hasOwn(call, 'args')) toolDelta.input = call.args;
  return toolDelta.name || hasOwn(toolDelta, 'input') ? toolDelta : null;
}
