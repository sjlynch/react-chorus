import { anthropicConnector } from '../anthropic';
import { aiSdkConnector } from '../aiSdk';
import { extractErrorMessage } from '../error';
import { geminiConnector } from '../gemini';
import { openaiConnector } from '../openai';
import type { ConnectorResult } from '../types';
import {
  genericJSONText,
  hasAiSdkUiMessageShape,
  hasAnthropicEventShape,
  hasGeminiCandidateShape,
  hasOpenAIChatShape,
  hasOpenAIResponseShape,
  isAutoDataStreamFrame,
} from './detection';
import { markConsumed, type AutoConnectorState } from './state';

export function extractAutoConnectorData(data: string, state: AutoConnectorState): ConnectorResult | null {
  if (data === '[DONE]') return openaiConnector.extract(data, state.openai) ?? { done: true };
  try {
    return extractAutoJSONData(data, JSON.parse(data), state);
  } catch {
    return extractAutoNonJSONData(data, state);
  }
}

function extractAutoJSONData(data: string, obj: unknown, state: AutoConnectorState): ConnectorResult | null {
  // Dispatch AI SDK typed frames before the generic error check: an AI SDK
  // frame with a stray top-level `error` key must be parsed as its frame
  // type here exactly as `aiSdkConnector` parses it, not turned into a
  // terminal stream error only on the `auto` path.
  if (hasAiSdkUiMessageShape(obj)) {
    markConsumed(state, 'aiSdk');
    return aiSdkConnector.extract(data, state.aiSdk);
  }
  const error = extractErrorMessage(obj);
  if (error) return { error, errorPayload: obj };
  if (hasOpenAIChatShape(obj)) {
    markConsumed(state, 'openai');
    return openaiConnector.extract(data, state.openai);
  }
  if (hasGeminiCandidateShape(obj)) {
    markConsumed(state, 'gemini');
    return geminiConnector.extract(data, state.gemini);
  }
  if (hasOpenAIResponseShape(obj)) {
    markConsumed(state, 'openai');
    return openaiConnector.extract(data, state.openai);
  }
  if (hasAnthropicEventShape(obj)) {
    markConsumed(state, 'anthropic');
    return anthropicConnector.extract(data, state.anthropic);
  }
  const genericText = genericJSONText(obj);
  if (genericText) return { text: genericText };
  return data ? { text: data } : null;
}

function extractAutoNonJSONData(data: string, state: AutoConnectorState): ConnectorResult | null {
  // Only commit a non-JSON line to the AI SDK data-stream parser when it is
  // genuinely a data-stream frame. Plain model output whose line happens to
  // start with `[a-z0-9]:` (e.g. `a: see below`, `d:0`) must fall through to
  // plain text rather than be dropped or terminate the stream early.
  if (isAutoDataStreamFrame(data)) {
    markConsumed(state, 'aiSdk');
    return aiSdkConnector.extract(data, state.aiSdk);
  }
  if (!data) return null;
  // Plain-text fallthrough: delegate to openaiConnector so DeepSeek-style
  // `<think>...</think>` traces are split into reasoning rather than rendered
  // verbatim. Per-stream think state lives in `state.openai`, so fragments
  // straddling chunk boundaries are preserved across calls.
  markConsumed(state, 'openai');
  return openaiConnector.extract(data, state.openai);
}
