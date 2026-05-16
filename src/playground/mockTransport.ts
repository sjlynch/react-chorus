import type { Transport } from '../hooks/useChorusStream';
import { REPLY_TEXTS } from './demoData';

const DEMO_CHUNK_DELAY_MS = 22;

interface StreamPlan {
  reasoning?: string;
  toolCall?: {
    id: string;
    name: string;
    input: Record<string, unknown>;
    output: unknown;
  };
  text: string;
}

function planFor(prompt: string): StreamPlan {
  const p = prompt.toLowerCase();

  if (p.includes('weather')) {
    const location = /weather\s+(?:in|at|for)\s+([a-zA-Z\s]+)/i.exec(prompt)?.[1]?.trim() || 'Tokyo';
    return {
      reasoning: `The user is asking about current weather conditions for ${location}. I'll call the weather tool with the location and metric units, then summarize the result in plain language.`,
      toolCall: {
        id: 'call_weather_1',
        name: 'get_weather',
        input: { location, units: 'metric' },
        output: {
          location,
          temperature_c: 22,
          condition: 'Partly cloudy',
          humidity: 0.58,
          wind_kmh: 12,
          wind_direction: 'E',
        },
      },
      text: REPLY_TEXTS.weather.replace('Tokyo', location),
    };
  }

  if (p.includes('code') || p.includes('sample') || p.includes('install')) {
    return {
      reasoning: 'Showing the smallest possible Chorus integration — a single import plus one component.',
      text: REPLY_TEXTS.code,
    };
  }

  if (p.includes('summar') || p.includes('feature') || p.includes('what can')) {
    return {
      reasoning: 'Compiling the headline features the user would notice in the first 30 seconds.',
      text: REPLY_TEXTS.summary,
    };
  }

  if (p.includes('markdown')) {
    return {
      reasoning: 'A quick tour through the markdown primitives Chorus renders out of the box.',
      text: REPLY_TEXTS.markdown,
    };
  }

  return {
    reasoning: 'No special intent detected — falling back to the default playground response.',
    text: REPLY_TEXTS.default,
  };
}

function tokenize(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [text];
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
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

function sseLine(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

async function* streamSSE(plan: StreamPlan, signal: AbortSignal): AsyncGenerator<string> {
  if (plan.reasoning) {
    for (const token of tokenize(plan.reasoning)) {
      await sleep(DEMO_CHUNK_DELAY_MS, signal);
      yield sseLine({ choices: [{ index: 0, delta: { reasoning_content: token } }] });
    }
  }

  if (plan.toolCall) {
    await sleep(DEMO_CHUNK_DELAY_MS * 3, signal);
    yield sseLine({
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: plan.toolCall.id,
            function: {
              name: plan.toolCall.name,
              arguments: JSON.stringify(plan.toolCall.input),
            },
            output: plan.toolCall.output,
          }],
        },
      }],
    });
    await sleep(DEMO_CHUNK_DELAY_MS * 4, signal);
  }

  for (const token of tokenize(plan.text)) {
    await sleep(DEMO_CHUNK_DELAY_MS, signal);
    yield sseLine({ choices: [{ index: 0, delta: { content: token } }] });
  }

  yield 'data: [DONE]\n\n';
}

export const mockTransport: Transport = (text, _history, signal) => {
  const plan = planFor(text);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const evt of streamSSE(plan, signal)) {
          controller.enqueue(encoder.encode(evt));
        }
      } catch (err) {
        if (!signal.aborted) {
          controller.error(err);
          return;
        }
      } finally {
        try { controller.close(); } catch {}
      }
    },
    cancel() {
      // ReadableStream cancelled from the consumer side; nothing to clean up.
    },
  });

  return Promise.resolve(new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  }));
};
