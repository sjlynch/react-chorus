import { sourceFromAnthropicCitation } from '../sourceMapping';
import type { ConnectorResult } from '../types';
import { blockIndexKey, fallbackToolId, type AnthropicConnectorState } from './state';

export function handleContentBlockDelta(
  obj: Record<string, unknown>,
  state: AnthropicConnectorState,
): ConnectorResult | null {
  const delta = obj.delta && typeof obj.delta === 'object'
    ? obj.delta as Record<string, unknown>
    : null;
  if (!delta) return null;

  if (
    delta.type === 'text_delta' &&
    typeof delta.text === 'string' &&
    delta.text
  ) {
    return { text: delta.text };
  }

  if (
    delta.type === 'thinking_delta' &&
    typeof delta.thinking === 'string' &&
    delta.thinking
  ) {
    return { reasoning: delta.thinking };
  }

  // The signature_delta event closes a thinking block with the cryptographic
  // signature the Anthropic Messages API requires when that thinking block is
  // replayed (e.g. during an autoContinueTools round trip). Surface it as
  // metadata so the provider-request mapper can re-attach it; without this the
  // signature is lost and the replayed request 400s.
  if (
    delta.type === 'signature_delta' &&
    typeof delta.signature === 'string' &&
    delta.signature
  ) {
    return { metadata: { thinkingSignature: delta.signature } };
  }

  // `citations_delta` events stream one citation per delta against the
  // active text content block (web-search, document, and code-execution
  // tool citations all use this shape). Surface each as a MessageSource;
  // the assistant text continues to come from `text_delta` events.
  if (delta.type === 'citations_delta') {
    const citation = (delta as { citation?: unknown }).citation;
    const source = sourceFromAnthropicCitation(citation);
    return source ? { source } : null;
  }

  if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
    const key = blockIndexKey(obj.index);
    const id = state.toolIdsByBlockIndex.get(key) ?? fallbackToolId(obj.index);
    const providerId = state.providerToolIdsByBlockIndex.get(key);
    return { toolDelta: {
      id,
      input: delta.partial_json,
      provider: 'anthropic',
      ...(providerId ? { providerId } : { generated: true }),
    } };
  }

  return null;
}
