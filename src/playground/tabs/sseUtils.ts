export const DEMO_CHUNK_DELAY_MS = 22;

export function tokenize(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [text];
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('Aborted'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal.reason ?? new Error('Aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function sseLine(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function sseDone(): string {
  return 'data: [DONE]\n\n';
}

export function makeSSEResponse(
  generator: (signal: AbortSignal) => AsyncGenerator<string>,
  signal: AbortSignal,
): Promise<Response> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const evt of generator(signal)) {
          controller.enqueue(encoder.encode(evt));
        }
      } catch (err) {
        if (!signal.aborted) {
          controller.error(err);
          return;
        }
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      /* consumer cancelled; nothing to clean up */
    },
  });
  return Promise.resolve(new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  }));
}

/** Emit OpenAI-shape `delta: { content: token }` chunks for a string, tokenized. */
export async function* streamTextTokens(text: string, signal: AbortSignal): AsyncGenerator<string> {
  for (const token of tokenize(text)) {
    await sleep(DEMO_CHUNK_DELAY_MS, signal);
    yield sseLine({ choices: [{ index: 0, delta: { content: token } }] });
  }
}

/** Emit OpenAI-shape `delta: { reasoning_content: token }` chunks. */
export async function* streamReasoningTokens(text: string, signal: AbortSignal): AsyncGenerator<string> {
  for (const token of tokenize(text)) {
    await sleep(DEMO_CHUNK_DELAY_MS, signal);
    yield sseLine({ choices: [{ index: 0, delta: { reasoning_content: token } }] });
  }
}
