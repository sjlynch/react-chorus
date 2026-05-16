import type { Transport } from '../../hooks/useChorusStream';
import type { Message } from '../../types';
import { DEMO_CHUNK_DELAY_MS, makeSSEResponse, sleep, sseDone, sseLine, streamReasoningTokens, streamTextTokens } from './sseUtils';

export interface WeatherFixture {
  location: string;
  temperature_c: number;
  condition: string;
  precipitation_mm: number;
  wind_kmh: number;
}

const WEATHER_FIXTURES: Record<string, WeatherFixture> = {
  tokyo: { location: 'Tokyo', temperature_c: 22, condition: 'Partly cloudy', precipitation_mm: 0, wind_kmh: 12 },
  paris: { location: 'Paris', temperature_c: 17, condition: 'Light rain', precipitation_mm: 3.4, wind_kmh: 18 },
  london: { location: 'London', temperature_c: 14, condition: 'Overcast', precipitation_mm: 1.2, wind_kmh: 22 },
  'san francisco': { location: 'San Francisco', temperature_c: 18, condition: 'Foggy', precipitation_mm: 0, wind_kmh: 14 },
  'new york': { location: 'New York', temperature_c: 26, condition: 'Sunny', precipitation_mm: 0, wind_kmh: 9 },
};

export function lookupWeather(location: string): WeatherFixture {
  const key = location.trim().toLowerCase();
  if (WEATHER_FIXTURES[key]) return WEATHER_FIXTURES[key];
  // Deterministic fallback so unknown cities still produce coherent output.
  const hash = Array.from(key).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return {
    location: location.trim() || 'Unknown',
    temperature_c: 12 + (hash % 18),
    condition: hash % 2 === 0 ? 'Partly cloudy' : 'Clear',
    precipitation_mm: hash % 5 === 0 ? 2.1 : 0,
    wind_kmh: 6 + (hash % 14),
  };
}

interface ToolCallSpec {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface IterationPlan {
  reasoning?: string;
  toolCalls?: ToolCallSpec[];
  text?: string;
}

function extractCities(prompt: string): string[] {
  const matches: string[] = [];
  for (const fixtureKey of Object.keys(WEATHER_FIXTURES)) {
    if (prompt.toLowerCase().includes(fixtureKey)) matches.push(WEATHER_FIXTURES[fixtureKey].location);
  }
  if (matches.length === 0) {
    // "weather in X and Y" / "X and Y weather" / "weather for X, Y, Z" parsing.
    const m = /(?:in|for|between|of|at)\s+([A-Z][a-zA-Z\s]+?)(?:\s+(?:and|vs|versus|or|,)\s+([A-Z][a-zA-Z\s]+?))?(?:\s+and\s+([A-Z][a-zA-Z\s]+?))?[\s?.!]*$/.exec(prompt);
    if (m) {
      for (let i = 1; i <= 3; i++) {
        const city = m[i]?.trim();
        if (city) matches.push(city);
      }
    }
  }
  return matches.length > 0 ? matches : ['Tokyo', 'Paris'];
}

function findToolMessages(history: Message[]): Extract<Message, { role: 'tool' }>[] {
  return history.filter((m): m is Extract<Message, { role: 'tool' }> => m.role === 'tool' && !!m.toolCall && Object.prototype.hasOwnProperty.call(m.toolCall, 'output'));
}

function findLastUserText(history: Message[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === 'user') return m.text;
  }
  return '';
}

function synthesize(toolMessages: Extract<Message, { role: 'tool' }>[], userPrompt: string): string {
  const rows = toolMessages
    .map(m => m.toolCall.output as WeatherFixture | undefined)
    .filter((out): out is WeatherFixture => !!out && typeof out === 'object' && 'temperature_c' in out);

  if (rows.length === 0) {
    return "I called the weather tool, but got no usable data back. Try asking again.";
  }

  if (rows.length === 1) {
    const r = rows[0];
    return `It's currently **${r.temperature_c} °C and ${r.condition.toLowerCase()}** in ${r.location}, with ${r.wind_kmh} km/h winds${r.precipitation_mm > 0 ? ` and about ${r.precipitation_mm} mm of recent precipitation` : ''}.`;
  }

  const summary = rows
    .map(r => `- **${r.location}**: ${r.temperature_c} °C, ${r.condition.toLowerCase()}${r.precipitation_mm > 0 ? ` (~${r.precipitation_mm} mm precip)` : ''}, ${r.wind_kmh} km/h wind`)
    .join('\n');

  const umbrella = rows.filter(r => r.precipitation_mm > 0).map(r => r.location);
  const trailer = umbrella.length > 0
    ? `\n\n☔ Bring an umbrella in ${umbrella.join(' and ')}.`
    : '\n\n☀️ No umbrella needed today.';

  return userPrompt.toLowerCase().includes('compare') || rows.length > 1
    ? `Here's the comparison you asked for:\n\n${summary}${trailer}`
    : summary + trailer;
}

function planForIteration(text: string, history: Message[]): IterationPlan {
  const toolMessagesWithOutput = findToolMessages(history);

  // Iteration 1+: history contains tool messages with outputs → synthesize.
  if (toolMessagesWithOutput.length > 0 && !text) {
    const userText = findLastUserText(history);
    return {
      reasoning: 'Tool results are back. Time to compose the answer.',
      text: synthesize(toolMessagesWithOutput, userText),
    };
  }

  // Iteration 0: parse the user prompt and emit one get_weather call per city.
  const cities = extractCities(text);
  return {
    reasoning: cities.length > 1
      ? `The user wants weather for ${cities.join(' and ')}. I'll call \`get_weather\` once per city in parallel, then synthesize the comparison once the tools come back.`
      : `Calling \`get_weather\` for ${cities[0]}.`,
    toolCalls: cities.map((city, i) => ({
      id: `call_weather_${i + 1}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      name: 'get_weather',
      input: { location: city, units: 'metric' },
    })),
  };
}

async function* streamSSE(plan: IterationPlan, signal: AbortSignal): AsyncGenerator<string> {
  if (plan.reasoning) yield* streamReasoningTokens(plan.reasoning, signal);

  if (plan.toolCalls?.length) {
    for (let i = 0; i < plan.toolCalls.length; i++) {
      await sleep(DEMO_CHUNK_DELAY_MS * 2, signal);
      const call = plan.toolCalls[i];
      yield sseLine({
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: i,
              id: call.id,
              function: {
                name: call.name,
                arguments: JSON.stringify(call.input),
              },
            }],
          },
        }],
      });
    }
    await sleep(DEMO_CHUNK_DELAY_MS * 3, signal);
  }

  if (plan.text) yield* streamTextTokens(plan.text, signal);

  yield sseDone();
}

export const toolAgentTransport: Transport = (text, history, signal) => {
  const plan = planForIteration(text, history);
  return makeSSEResponse((sig) => streamSSE(plan, sig), signal);
};
