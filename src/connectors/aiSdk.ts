import { extractErrorMessage } from './error';
import type { Connector, ConnectorResult } from './types';
import { dataStreamProtocolResult } from './aiSdk/dataStream';
import {
  type AiSdkConnectorState,
  createAiSdkConnectorState,
  resetAiSdkState,
} from './aiSdk/shared';
import { uiMessageStreamResult } from './aiSdk/uiMessageStream';

export type { AiSdkConnectorState } from './aiSdk/shared';
export { createAiSdkConnectorState } from './aiSdk/shared';
export { isAiSdkFrameType } from './aiSdk/uiMessageStream';

/**
 * Vercel AI SDK streaming connector.
 *
 * Reads frames from both Vercel AI SDK protocols:
 *
 * - **UI message stream** (`toUIMessageStreamResponse`, v5+): SSE `data:` lines
 *   carrying JSON like `{"type":"text-delta","delta":"hi"}` or
 *   `{"type":"tool-input-available","toolCallId":"...","input":{...}}`.
 * - **Data stream protocol** (`toDataStreamResponse`, v4): one prefix-coded
 *   frame per line like `0:"hi"` or `9:{"toolCallId":"...","toolName":"..."}`.
 *   The pipeline expects each frame to arrive as the value of an SSE `data:`
 *   field, so a server route that emits raw data-stream lines must wrap each
 *   one as `data: <line>\n\n` (see README's Vercel AI SDK recipe for a one-line
 *   adapter).
 *
 * The connector returns text/reasoning/tool deltas, signals done on `finish` /
 * `finish-message` / `d:` / `e:` frames, and surfaces in-band errors (`type: 'error'`
 * or `3:"..."`) with the original payload as `errorPayload`. Unknown or
 * lifecycle-only frames (`start`, `start-step`, `text-start`, `text-end`, etc.)
 * are silently ignored so the user never sees protocol text. Empty-string
 * argument deltas (`{type:'tool-input-delta', inputTextDelta:''}` and `c:`
 * frames with an empty `argsTextDelta`) are dropped the same way empty
 * `text-delta` / `reasoning-delta` frames are, so an empty fragment never
 * resets accumulated tool input.
 *
 * **`toolCallId` is required** on every tool frame (`tool-input-start` /
 * `tool-call-streaming-start`, `tool-input-delta` / `tool-call-delta`,
 * `tool-input-available` / `tool-call`, `tool-output-available` / `tool-result`,
 * and the data-stream `9:` / `b:` / `c:` / `a:` frames). When a recognized tool
 * frame arrives without a `toolCallId`, the connector intentionally drops the
 * fragment (there is no tool message to merge it into) and emits a dev-only
 * `console.warn` naming the frame type and the missing field. The warning
 * fires at most once per (frame-type, missing-field) combination; production
 * builds stay silent.
 *
 * Usage example:
 *   const { send } = useChorusStream(transport, { connector: 'ai-sdk' });
 */
export const aiSdkConnector: Connector<AiSdkConnectorState> = {
  name: 'ai-sdk',
  createState: createAiSdkConnectorState,
  extract(data: string, state = createAiSdkConnectorState()): ConnectorResult | null {
    if (data === '[DONE]') {
      resetAiSdkState(state);
      return { done: true };
    }

    try {
      const obj = JSON.parse(data);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const result = uiMessageStreamResult(state, obj as Record<string, unknown>, obj);
        if (result) return result;
        const error = extractErrorMessage(obj);
        if (error) return { error, errorPayload: obj };
      }
    } catch {
      const result = dataStreamProtocolResult(state, data);
      if (result) return result;
    }

    return null;
  },
};
