import { hasOwn } from '../objectUtils';
import { sourcesFromAnthropicWebSearchToolResult } from '../sourceMapping';
import type { ConnectorResult, ConnectorToolDelta } from '../types';
import { collectAnthropicCitations, sourcesResult } from './citations';
import { blockIndexKey, fallbackToolId, type AnthropicConnectorState } from './state';

export function handleContentBlockStart(
  obj: Record<string, unknown>,
  state: AnthropicConnectorState,
): ConnectorResult | null {
  const block = obj.content_block;
  if (!block || typeof block !== 'object') return null;

  const blockObj = block as Record<string, unknown>;

  if (blockObj.type === 'thinking') {
    const reasoning = typeof blockObj.thinking === 'string' ? blockObj.thinking : '';
    return reasoning ? { reasoning } : null;
  }

  if (blockObj.type === 'tool_use') {
    const explicitId = typeof blockObj.id === 'string' && blockObj.id ? blockObj.id : undefined;
    const id = explicitId ?? fallbackToolId(obj.index);
    const key = blockIndexKey(obj.index);
    state.toolIdsByBlockIndex.set(key, id);
    if (explicitId) state.providerToolIdsByBlockIndex.set(key, explicitId);
    const toolDelta: ConnectorToolDelta = { id, provider: 'anthropic' };
    if (explicitId) toolDelta.providerId = explicitId;
    else toolDelta.generated = true;
    if (typeof blockObj.name === 'string' && blockObj.name) toolDelta.name = blockObj.name;
    if (hasOwn(blockObj, 'input')) toolDelta.input = blockObj.input;
    return toolDelta.name || hasOwn(toolDelta, 'input') ? { toolDelta } : null;
  }

  // `web_search_tool_result` carries an array of `web_search_result`
  // entries (url/title/encrypted_content) that the model used as
  // grounding. Surface each as a MessageSource so they appear in the
  // assistant's Sources footer instead of being silently dropped.
  if (blockObj.type === 'web_search_tool_result') {
    const sources = sourcesFromAnthropicWebSearchToolResult(blockObj);
    return sources.length ? sourcesResult(sources) : null;
  }

  // A text content block can be seeded with `citations` (rare on
  // streaming responses, but valid). Capture them so a non-streaming
  // replay through the same connector behaves identically.
  if (blockObj.type === 'text' && Array.isArray((blockObj as { citations?: unknown }).citations)) {
    const sources = collectAnthropicCitations((blockObj as { citations?: unknown[] }).citations);
    return sources.length ? sourcesResult(sources) : null;
  }

  return null;
}
