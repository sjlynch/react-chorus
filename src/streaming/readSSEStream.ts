import { ChorusStreamError } from './errors';

// Local duplicate keeps streaming-only imports from pulling UI-owned utility chunks.
function createAbortError(message = 'Aborted'): Error {
  if (typeof DOMException === 'function') return new DOMException(message, 'AbortError') as Error;
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

const MALFORMED_SSE_PREVIEW_CHARS = 256;

function createMalformedSseError(res: Response, bodyPreview: string, truncated: boolean): ChorusStreamError {
  const contentType = res.headers.get('content-type');
  const ctPart = contentType ? ` Received Content-Type "${contentType}".` : '';
  const preview = bodyPreview.trim();
  const previewPart = preview ? ` Body started with: ${preview}${truncated ? '…' : ''}` : '';
  return new ChorusStreamError(
    `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''} response contained no Server-Sent Events. ` +
    `Expected Content-Type "text/event-stream" with \`data:\` lines.${ctPart}${previewPart}`,
  );
}

function isEventStreamResponse(res: Response): boolean {
  return (res.headers.get('content-type') || '').toLowerCase().includes('text/event-stream');
}

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

  let currentLine = '';
  let skipNextLF = false;
  let dataLines: string[] = [];
  let eventName = '';
  let stopped = false;
  let sawStreamStart = false;
  let sawDataField = false;
  let sawSseFrame = false;
  let bodyTotalLength = 0;
  let bodyPreview = '';

  const flushEvent = () => {
    // Per the SSE spec the event-type buffer resets on every blank line,
    // whether or not a data payload is dispatched.
    const name = eventName;
    eventName = '';
    if (!dataLines.length || stopped) return;
    const payload = dataLines.join('\n');
    dataLines = [];
    if (onEvent(payload, name || undefined) === false) stopped = true;
  };

  const processLine = (line: string) => {
    if (stopped) return;
    if (line === '') { flushEvent(); return; }

    const colon = line.indexOf(':');
    // A line starting with a colon is an SSE comment (`: keepalive`). Ignore its
    // content, but record that the stream was SSE-shaped.
    if (colon === 0) { sawSseFrame = true; return; }

    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'data') {
      sawDataField = true;
      sawSseFrame = true;
      dataLines.push(value);
    } else if (field === 'event') {
      sawSseFrame = true;
      eventName = value;
    }
  };

  const processText = (text: string) => {
    if (text.length > 0) {
      bodyTotalLength += text.length;
      if (bodyPreview.length < MALFORMED_SSE_PREVIEW_CHARS) {
        bodyPreview = (bodyPreview + text).slice(0, MALFORMED_SSE_PREVIEW_CHARS);
      }
    }
    for (let i = 0; !stopped && i < text.length; i += 1) {
      const ch = text[i];
      if (!sawStreamStart) {
        sawStreamStart = true;
        if (ch === '\uFEFF') continue;
      }

      if (skipNextLF) {
        skipNextLF = false;
        if (ch === '\n') continue;
      }

      if (ch === '\r') {
        processLine(currentLine);
        currentLine = '';
        skipNextLF = true;
      } else if (ch === '\n') {
        processLine(currentLine);
        currentLine = '';
      } else {
        currentLine += ch;
      }
    }
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
      stopped = true;
      dataLines = [];
      currentLine = '';
      void cancelReader();
      settleReject(createAbortError());
    }

    signal?.addEventListener('abort', onAbort, { once: true });

    (async () => {
      try {
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          processText(decoder.decode(value, { stream: true }));
        }
        if (!stopped) {
          processText(decoder.decode());
          if (currentLine.length) {
            processLine(currentLine);
            currentLine = '';
          }
          flushEvent();

          // A successful HTTP response that never delivered a single SSE `data:` field is
          // almost certainly a backend mistake (200 JSON `{ "error": ... }` or plain text
          // instead of `text/event-stream`). Without this guard the stream closes silently
          // and the UI looks broken — no chunks, no error banner, no onError callback.
          //
          // But a spec-valid `text/event-stream` may legitimately carry only `:` keepalive
          // comments or named `event:` lines with no `data:` field — e.g. heartbeats before
          // a turn that produced no streamed output. Skip the guard when the response is a
          // `text/event-stream` AND at least one SSE-shaped line (`data:` / `event:` / `:`
          // comment) was observed; otherwise the body is not SSE and the guard still fires.
          if (
            !sawDataField &&
            bodyTotalLength > 0 &&
            bodyPreview.trim().length > 0 &&
            (!isEventStreamResponse(res) || !sawSseFrame)
          ) {
            throw createMalformedSseError(res, bodyPreview, bodyTotalLength > bodyPreview.length);
          }
        }
        if (stopped) await cancelReader();
        settleResolve();
      } catch (err) {
        await cancelReader();
        settleReject(err);
      }
    })();
  });
}
