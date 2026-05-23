type SSEEventCallback = (payload: string, eventName?: string) => unknown;

export interface SSEParserSnapshot {
  sawDataField: boolean;
  sawSseFrame: boolean;
  stopped: boolean;
}

export interface SSEParser extends SSEParserSnapshot {
  push(text: string): void;
  finish(): void;
  stop(): void;
  getSnapshot(): SSEParserSnapshot;
}

/**
 * Stream-independent SSE parser/state machine.
 *
 * It implements the EventSource line algorithm used by `readSSEStream`:
 * - split on LF, CR, or CRLF, including separators split across chunks
 * - strip exactly one leading UTF-8 BOM
 * - collect `data` field lines and reset `event` on every blank line
 * - ignore comments/keepalives while still marking the body as SSE-shaped
 * - dispatch the final buffered event at EOF even without a trailing blank line
 */
export function createSSEParser(onEvent: SSEEventCallback): SSEParser {
  let currentLine = '';
  let skipNextLF = false;
  let dataLines: string[] = [];
  let eventName = '';
  let stopped = false;
  let sawStreamStart = false;
  let sawDataField = false;
  let sawSseFrame = false;

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
    if (line === '') {
      flushEvent();
      return;
    }

    const colon = line.indexOf(':');
    // A line starting with a colon is an SSE comment (`: keepalive`). Ignore its
    // content, but record that the stream was SSE-shaped.
    if (colon === 0) {
      sawSseFrame = true;
      return;
    }

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

  const parser: SSEParser = {
    push(text: string) {
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
    },
    finish() {
      if (stopped) return;
      if (currentLine.length) {
        processLine(currentLine);
        currentLine = '';
      }
      flushEvent();
    },
    stop() {
      stopped = true;
      currentLine = '';
      skipNextLF = false;
      dataLines = [];
      eventName = '';
    },
    getSnapshot() {
      return { sawDataField, sawSseFrame, stopped };
    },
    get sawDataField() {
      return sawDataField;
    },
    get sawSseFrame() {
      return sawSseFrame;
    },
    get stopped() {
      return stopped;
    },
  };

  return parser;
}
