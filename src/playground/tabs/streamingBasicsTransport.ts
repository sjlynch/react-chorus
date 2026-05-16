import type { Transport } from '../../hooks/useChorusStream';
import { DEMO_CHUNK_DELAY_MS, makeSSEResponse, sleep, sseDone, sseLine, streamReasoningTokens, streamTextTokens } from './sseUtils';

const REPLY_TEXTS = {
  code: "Here's the smallest possible integration:\n\n```tsx\nimport { Chorus } from 'react-chorus';\nimport 'react-chorus/styles.css';\n\nexport default function App() {\n  return <Chorus transport=\"/api/chat\" />;\n}\n```\n\nPoint `transport` at any SSE endpoint (OpenAI, Anthropic, Gemini, or your own) and the connector auto-detects the format.",
  weather: "It's currently **22 °C and partly cloudy** in Tokyo, with 58% humidity and light winds out of the east. Comfortable jacket weather — no rain expected for the next few hours.",
  retry: "Streaming a second reply after the error was dismissed. Notice that retry preserved your turn while the failed assistant turn was rolled back.",
  default: "react-chorus keeps the drop-in defaults while exposing composable hooks and components. The reply you just saw streamed through a mock `Transport` — swap it for your real SSE endpoint and the same UI keeps working.",
};

interface StreamPlan {
  reasoning?: string;
  toolCall?: {
    id: string;
    name: string;
    input: Record<string, unknown>;
    output: unknown;
  };
  text?: string;
  /** Emit an OpenAI-shape in-band error after a brief delay. */
  errorMessage?: string;
}

function planFor(prompt: string): StreamPlan {
  const p = prompt.toLowerCase();

  if (p.includes('force error') || p.includes('make this fail') || p.includes('trigger error')) {
    return {
      reasoning: 'Demonstrating the in-band error path — the transport will emit an OpenAI-shape error payload instead of finishing normally.',
      errorMessage: 'Rate limit exceeded — try again in a moment.',
    };
  }

  if (p.includes('weather')) {
    const location = /weather\s+(?:in|at|for)\s+([a-zA-Z\s]+)/i.exec(prompt)?.[1]?.trim() || 'Tokyo';
    return {
      reasoning: `The user is asking about current weather conditions for ${location}. I'll call the weather tool with the location and metric units, then summarize the result in plain language.`,
      toolCall: {
        id: 'call_weather_basics',
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

  return {
    reasoning: 'No special intent detected — falling back to the default streaming response.',
    text: REPLY_TEXTS.default,
  };
}

async function* streamSSE(plan: StreamPlan, signal: AbortSignal): AsyncGenerator<string> {
  if (plan.reasoning) yield* streamReasoningTokens(plan.reasoning, signal);

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

  if (plan.errorMessage) {
    await sleep(DEMO_CHUNK_DELAY_MS * 6, signal);
    yield sseLine({ error: { message: plan.errorMessage, type: 'demo_error' } });
    return;
  }

  if (plan.text) yield* streamTextTokens(plan.text, signal);

  yield sseDone();
}

export const streamingBasicsTransport: Transport = (text, _history, signal) => {
  const plan = planFor(text);
  return makeSSEResponse((sig) => streamSSE(plan, sig), signal);
};
