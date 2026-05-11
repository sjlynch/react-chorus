import type { Connector, ConnectorResult } from './openai';

/**
 * Google Gemini streaming connector (Google AI / Vertex AI).
 * Expects SSE data lines with JSON objects containing a "candidates" array.
 * Yields text from candidates[*].content.parts[*].text.
 * Signals done when any candidate has a finishReason set.
 *
 * Usage example:
 *   const { send } = useChorusStream(transport, { connector: 'gemini' });
 */
export const geminiConnector: Connector = {
  name: 'gemini',
  extract(data: string): ConnectorResult | null {
    try {
      const obj = JSON.parse(data);
      if (!obj || !Array.isArray(obj.candidates)) return null;

      let text = '';
      let done = false;

      for (const candidate of obj.candidates) {
        if (candidate?.finishReason) done = true;
        const parts = candidate?.content?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            if (typeof part?.text === 'string') text += part.text;
          }
        }
      }

      if (text && done) return { text, done: true };
      if (text) return { text };
      if (done) return { done: true };
      return null;
    } catch {
      return null;
    }
  }
};
