export interface AnthropicConnectorState {
  toolIdsByBlockIndex: Map<string, string>;
  providerToolIdsByBlockIndex: Map<string, string>;
}

export function createAnthropicConnectorState(): AnthropicConnectorState {
  return { toolIdsByBlockIndex: new Map<string, string>(), providerToolIdsByBlockIndex: new Map<string, string>() };
}

export function resetAnthropicState(state: AnthropicConnectorState) {
  state.toolIdsByBlockIndex.clear();
  state.providerToolIdsByBlockIndex.clear();
}

export function blockIndexKey(index: unknown) {
  return typeof index === 'number' || typeof index === 'string' ? String(index) : '0';
}

export function fallbackToolId(index: unknown) {
  return `anthropic-tool-${blockIndexKey(index)}`;
}
