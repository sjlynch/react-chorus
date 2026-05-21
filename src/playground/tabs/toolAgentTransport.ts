import type { Transport } from '../../hooks/useChorusStream';
import type { Message } from '../../types';
import { streamOpenAIDemoPlan, type DemoStreamToolCall } from './demoStreamPlan';
import { extractWeatherCities } from './promptIntent';
import { makeSSEResponse } from './sseUtils';
import type { WeatherFixture } from './weatherFixtures';

interface IterationPlan {
  reasoning?: string;
  toolCalls?: DemoStreamToolCall[];
  text?: string;
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
  const cities = extractWeatherCities(text);
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

export const toolAgentTransport: Transport = (text, history, signal) => {
  const plan = planForIteration(text, history);
  return makeSSEResponse((sig) => streamOpenAIDemoPlan(plan, sig), signal);
};
