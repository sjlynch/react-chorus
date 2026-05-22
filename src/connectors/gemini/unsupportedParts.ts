// Gemini content parts the connector has no channel to render as assistant
// content:
//   - `inlineData` (base64 bytes with a mimeType) and `fileData` (a file URI)
//     from multimodal / image-generation models — binary payloads.
//   - `executableCode` (generated code) and `codeExecutionResult` (its output)
//     from the code-execution tool.
// Snake_case spellings are accepted because some proxies/SDKs reshape the wire
// JSON. Without these entries a candidate whose only parts are code-execution
// parts would return `null` and surface as a blank assistant turn with no
// diagnostic.
const UNSUPPORTED_PART_KEYS: Array<{ key: string; label: string }> = [
  { key: 'inlineData', label: 'inlineData' },
  { key: 'inline_data', label: 'inlineData' },
  { key: 'fileData', label: 'fileData' },
  { key: 'file_data', label: 'fileData' },
  { key: 'executableCode', label: 'executableCode' },
  { key: 'executable_code', label: 'executableCode' },
  { key: 'codeExecutionResult', label: 'codeExecutionResult' },
  { key: 'code_execution_result', label: 'codeExecutionResult' },
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
