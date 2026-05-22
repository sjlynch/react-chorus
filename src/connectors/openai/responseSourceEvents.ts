import type { ConnectorResult } from '../types';
import { sourcesFromOpenAIResponseEvent } from '../sourceMapping';

/**
 * Responses API citation/source annotations. These events carry non-text
 * metadata associated with output text; surface them as structured message
 * sources instead of leaking the provider JSON into the transcript.
 */
export function handleResponseSourceEvent(obj: Record<string, unknown>): ConnectorResult | null {
  const sources = sourcesFromOpenAIResponseEvent(obj);
  return sources.length ? { sources } : null;
}
