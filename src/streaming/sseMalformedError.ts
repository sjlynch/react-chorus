import { ChorusStreamError } from './errors';
import type { SSEParserSnapshot } from './sseParser';

export const MALFORMED_SSE_PREVIEW_CHARS = 256;

export function createMalformedSseError(res: Response, bodyPreview: string, truncated: boolean): ChorusStreamError {
  const contentType = res.headers.get('content-type');
  const ctPart = contentType ? ` Received Content-Type "${contentType}".` : '';
  const preview = bodyPreview.trim();
  const previewPart = preview ? ` Body started with: ${preview}${truncated ? '…' : ''}` : '';
  return new ChorusStreamError(
    `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''} response contained no Server-Sent Events. ` +
    `Expected Content-Type "text/event-stream" with \`data:\` lines.${ctPart}${previewPart}`,
  );
}

export function isEventStreamResponse(res: Response): boolean {
  return (res.headers.get('content-type') || '').toLowerCase().includes('text/event-stream');
}

export function createBodyPreviewTracker() {
  let totalLength = 0;
  let preview = '';

  return {
    record(text: string) {
      if (text.length === 0) return;
      totalLength += text.length;
      if (preview.length < MALFORMED_SSE_PREVIEW_CHARS) {
        preview = (preview + text).slice(0, MALFORMED_SSE_PREVIEW_CHARS);
      }
    },
    get totalLength() {
      return totalLength;
    },
    get preview() {
      return preview;
    },
    get truncated() {
      return totalLength > preview.length;
    },
  };
}

export function shouldRejectMalformedSse(res: Response, parser: SSEParserSnapshot, body: ReturnType<typeof createBodyPreviewTracker>) {
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
  return (
    !parser.sawDataField &&
    body.totalLength > 0 &&
    body.preview.trim().length > 0 &&
    (!isEventStreamResponse(res) || !parser.sawSseFrame)
  );
}
