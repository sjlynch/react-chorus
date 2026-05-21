import { anthropicConnector } from '../anthropic';
import { aiSdkConnector } from '../aiSdk';
import { geminiConnector } from '../gemini';
import { openaiConnector } from '../openai';
import type { ConnectorResult } from '../types';

/** Sub-connector that parsed (consumed) frames on an `auto` stream. */
export type AutoConsumer = 'openai' | 'anthropic' | 'gemini' | 'aiSdk';

export interface AutoConnectorState {
  openai?: ReturnType<NonNullable<typeof openaiConnector.createState>>;
  anthropic?: ReturnType<NonNullable<typeof anthropicConnector.createState>>;
  gemini?: ReturnType<NonNullable<typeof geminiConnector.createState>>;
  aiSdk?: ReturnType<NonNullable<typeof aiSdkConnector.createState>>;
  /**
   * Sub-connector that first parsed a frame on this stream. `flush()` drains
   * the connector-buffered tail through this connector so an auto-detected
   * Anthropic / Gemini / AI SDK stream is flushed by the connector that
   * actually consumed it instead of always OpenAI.
   */
  consumedBy?: AutoConsumer;
}

export function createAutoConnectorState(): AutoConnectorState {
  return {
    openai: openaiConnector.createState?.(),
    anthropic: anthropicConnector.createState?.(),
    gemini: geminiConnector.createState?.(),
    aiSdk: aiSdkConnector.createState?.(),
  };
}

/** Record the first sub-connector to consume the stream; later frames keep it. */
export function markConsumed(state: AutoConnectorState, consumer: AutoConsumer): void {
  if (!state.consumedBy) state.consumedBy = consumer;
}

export function flushAutoConnectorState(state: AutoConnectorState): ConnectorResult | null {
  switch (state.consumedBy) {
    case 'anthropic':
      return anthropicConnector.flush?.(state.anthropic) ?? null;
    case 'gemini':
      return geminiConnector.flush?.(state.gemini) ?? null;
    case 'aiSdk':
      return aiSdkConnector.flush?.(state.aiSdk) ?? null;
    case 'openai':
    default:
      return openaiConnector.flush?.(state.openai) ?? null;
  }
}
