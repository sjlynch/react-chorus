import { createAbortError } from './internal/streamErrors';
import { createSSEParser } from './sseParser';
import { createBodyPreviewTracker, createMalformedSseError, shouldRejectMalformedSse } from './sseMalformedError';

export { createSSEParser } from './sseParser';
export type { SSEParser, SSEParserSnapshot } from './sseParser';

/**
 * Robust SSE reader:
 * - Parses the stream line-by-line (handles CR, LF, and chunk boundaries)
 * - Collects data field lines for an event; dispatches on a blank line
 * - Captures the most recent `event:` name and passes it to `onEvent`
 *   (`undefined` when the frame had no `event:` field, per the SSE spec)
 * - Strips one leading UTF-8 BOM and supports colonless fields per the SSE algorithm
 * - Preserves empty data lines (blank lines inside payloads)
 */
export function readSSEStream(res: Response, onEvent: (payload: string, eventName?: string) => unknown, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(createAbortError());
  if (!res.body) return Promise.resolve();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSSEParser(onEvent);
  const body = createBodyPreviewTracker();

  const processText = (text: string) => {
    body.record(text);
    parser.push(text);
  };

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };

    const settleResolve = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const settleReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const cancelReader = async () => {
      try { await reader.cancel(); } catch {}
    };

    function onAbort() {
      parser.stop();
      void cancelReader();
      settleReject(createAbortError());
    }

    signal?.addEventListener('abort', onAbort, { once: true });

    (async () => {
      try {
        while (!parser.stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          processText(decoder.decode(value, { stream: true }));
        }
        if (!parser.stopped) {
          processText(decoder.decode());
          parser.finish();

          if (shouldRejectMalformedSse(res, parser, body)) {
            throw createMalformedSseError(res, body.preview, body.truncated);
          }
        }
        if (parser.stopped) await cancelReader();
        settleResolve();
      } catch (err) {
        await cancelReader();
        settleReject(err);
      }
    })();
  });
}
