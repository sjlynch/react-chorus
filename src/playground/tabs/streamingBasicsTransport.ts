import type { Transport } from '../../hooks/useChorusStream';
import { streamOpenAIDemoPlan, type OpenAIDemoStreamPlan } from './demoStreamPlan';
import { extractWeatherLocation, isErrorPrompt } from './promptIntent';
import { makeSSEResponse } from './sseUtils';
import { makeBasicWeatherFixture } from './weatherFixtures';

const REPLY_TEXTS = {
  code: "Here's the smallest possible integration:\n\n```tsx\nimport { Chorus } from 'react-chorus';\nimport 'react-chorus/styles.css';\n\nexport default function App() {\n  return <Chorus transport=\"/api/chat\" />;\n}\n```\n\nPoint `transport` at any SSE endpoint (OpenAI, Anthropic, Gemini, or your own) and the connector auto-detects the format.",
  weather: "It's currently **22 °C and partly cloudy** in Tokyo, with 58% humidity and light winds out of the east. Comfortable jacket weather — no rain expected for the next few hours.",
  retry: "Streaming a second reply after the error was dismissed. Notice that retry preserved your turn while the failed assistant turn was rolled back.",
  default: "react-chorus keeps the drop-in defaults while exposing composable hooks and components. The reply you just saw streamed through a mock `Transport` — swap it for your real SSE endpoint and the same UI keeps working.",
};

/**
 * Error-triggering prompts that have already streamed the in-band error once.
 * The next resend of the same prompt — clicking Retry, or re-sending the chip
 * after dismissing the error — streams REPLY_TEXTS.retry instead of erroring
 * again, so the tab demonstrates recovery as well as failure. The entry is
 * cleared on that resend so a later send can show the error again.
 */
const erroredPrompts = new Set<string>();

function planFor(prompt: string, isErrorResend: boolean): OpenAIDemoStreamPlan {
  const p = prompt.toLowerCase();

  if (isErrorPrompt(p)) {
    if (isErrorResend) {
      return {
        reasoning: 'Resending after the dismissed error — this attempt streams normally so you can watch the turn recover.',
        text: REPLY_TEXTS.retry,
      };
    }
    return {
      reasoning: 'Demonstrating the in-band error path — the transport will emit an OpenAI-shape error payload instead of finishing normally.',
      errorMessage: 'Rate limit exceeded — try again in a moment.',
    };
  }

  if (p.includes('weather')) {
    const location = extractWeatherLocation(prompt);
    return {
      reasoning: `The user is asking about current weather conditions for ${location}. I'll call the weather tool with the location and metric units, then summarize the result in plain language.`,
      toolCalls: [{
        id: 'call_weather_basics',
        name: 'get_weather',
        input: { location, units: 'metric' },
        // `output` is a react-chorus connector extension, not part of
        // OpenAI's Chat Completions wire format. It lets this basics tab show
        // a completed tool call in a single streamed turn; the Tool agent tab
        // demonstrates the full execute-and-continue loop instead.
        output: makeBasicWeatherFixture(location),
      }],
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

export const streamingBasicsTransport: Transport = (text, _history, signal) => {
  // Toggle the error/retry demo: the first error-triggering send streams the
  // in-band error; the immediate resend streams the recovery reply instead.
  const key = text.toLowerCase();
  let isErrorResend = false;
  if (isErrorPrompt(key)) {
    isErrorResend = erroredPrompts.has(key);
    if (isErrorResend) erroredPrompts.delete(key);
    else erroredPrompts.add(key);
  }
  const plan = planFor(text, isErrorResend);
  return makeSSEResponse(
    (sig) => streamOpenAIDemoPlan(plan, sig, {
      toolCallDelayMultiplier: 3,
      afterToolCallsDelayMultiplier: 4,
    }),
    signal,
  );
};
