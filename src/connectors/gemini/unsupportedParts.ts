// Gemini multimodal / image-generation models stream `inlineData` (base64 bytes
// with a mimeType) and `fileData` (a file URI) content parts. The connector has
// no text/reasoning/tool channel for binary payloads, so they cannot be rendered
// as assistant content today; snake_case spellings are accepted because some
// proxies/SDKs reshape the wire JSON.
const UNSUPPORTED_PART_KEYS: Array<{ key: string; label: string }> = [
  { key: 'inlineData', label: 'inlineData' },
  { key: 'inline_data', label: 'inlineData' },
  { key: 'fileData', label: 'fileData' },
  { key: 'file_data', label: 'fileData' },
];

/**
 * Detect a Gemini content part the connector cannot turn into text/reasoning/
 * tool output. Returns a short label (with mime type when present) so the
 * absence can be surfaced as a `ConnectorWarning` instead of silently dropping
 * the chunk; returns null for ordinary parts.
 */
export function describeUnsupportedPart(partObj: Record<string, unknown>): string | null {
  for (const { key, label } of UNSUPPORTED_PART_KEYS) {
    const value = partObj[key];
    if (!value || typeof value !== 'object') continue;
    const data = value as Record<string, unknown>;
    const mimeType = typeof data.mimeType === 'string' && data.mimeType
      ? data.mimeType
      : typeof data.mime_type === 'string' && data.mime_type
        ? data.mime_type
        : undefined;
    return mimeType ? `${label} (${mimeType})` : label;
  }
  return null;
}
