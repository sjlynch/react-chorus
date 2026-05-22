import type { ConnectorResult } from '../types';
import type { OpenAIConnectorState } from '../openai';
import { stringFromUnknown } from './shared';
import { refusalKey } from './responseToolCalls';

/**
 * Refusal lifecycle: `response.refusal.added` / `.delta` / `.done`.
 *
 * Refusal text is buffered across `.added` (seeds an empty entry) and `.delta`
 * (appends) under `refusalKey(obj)`, then surfaced as an error on `.done`. The
 * `.added`/`.delta` events return `null` because the refusal is not complete
 * yet; if `.done` never arrives the terminal handler drains the buffer via
 * `drainResponseRefusalText`.
 */
export function handleResponseRefusalEvent(obj: Record<string, unknown>, state: OpenAIConnectorState): ConnectorResult | null {
  if (obj.type === 'response.refusal.added') {
    state.responseRefusalText.set(refusalKey(obj), '');
    return null;
  }

  if (obj.type === 'response.refusal.delta') {
    const key = refusalKey(obj);
    const delta = stringFromUnknown(obj.delta);
    if (delta) state.responseRefusalText.set(key, (state.responseRefusalText.get(key) ?? '') + delta);
    return null;
  }

  // `response.refusal.done`
  const key = refusalKey(obj);
  const finalText = stringFromUnknown(obj.refusal) || state.responseRefusalText.get(key) || 'OpenAI model refused to respond';
  state.responseRefusalText.delete(key);
  return { error: finalText, errorPayload: obj };
}
