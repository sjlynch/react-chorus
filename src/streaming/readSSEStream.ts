// Local duplicate keeps streaming-only imports from pulling UI-owned utility chunks.
function createAbortError(message = 'Aborted'): Error {
  if (typeof DOMException === 'function') return new DOMException(message, 'AbortError') as Error;
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

/**
 * Robust SSE reader:
 * - Parses the stream line-by-line (handles CR, LF, and chunk boundaries)
 * - Collects data field lines for an event; dispatches on a blank line
 * - Strips one leading UTF-8 BOM and supports colonless fields per the SSE algorithm
 * - Preserves empty data lines (blank lines inside payloads)
 */
export function readSSEStream(res: Response, onEvent: (payload: string) => unknown, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(createAbortError());
  if (!res.body) return Promise.resolve();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let currentLine = '';
  let skipNextLF = false;
  let dataLines: string[] = [];
  let stopped = false;
  let sawStreamStart = false;

  const flushEvent = () => {
    if (!dataLines.length || stopped) return;
    const payload = dataLines.join('\n');
    dataLines = [];
    if (onEvent(payload) === false) stopped = true;
  };

  const processLine = (line: string) => {
    if (stopped) return;
    if (line === '') { flushEvent(); return; }

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'data') dataLines.push(value);
  };

  const processText = (text: string) => {
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
