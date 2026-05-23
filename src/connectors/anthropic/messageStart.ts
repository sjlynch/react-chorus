import type { ConnectorResult } from '../types';
import { extractUsage } from '../usage';

export function handleMessageStart(obj: Record<string, unknown>): ConnectorResult | null {
  // `message_start` carries `message.usage.input_tokens` (the prompt
  // token count); the matching output count arrives on `message_delta`.
  // Surface it so cost telemetry is not silently dropped.
  const message = obj.message && typeof obj.message === 'object'
    ? obj.message as Record<string, unknown>
    : null;
  const usage = extractUsage(message?.usage);
  return usage ? { metadata: { usage } } : null;
}
