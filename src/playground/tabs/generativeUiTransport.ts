import type { Transport } from '../../hooks/useChorusStream';
import type { Message } from '../../types';
import { RESERVED_BLOCK_TOOL_NAME } from '../../reservedIds';
import { makeOpenAIToolCallChunk } from './openAIChunkBuilders';
import { DEMO_CHUNK_DELAY_MS, makeSSEResponse, sleep, sseDone, sseLine, streamTextTokens } from './sseUtils';

interface BlockPlan {
  blockName: string;
  intro: string;
  /** Final props streamed as a single chunk. The connector reassembles JSON deltas; one chunk is enough for the demo. */
  props: Record<string, unknown>;
}

function planForPrompt(text: string): BlockPlan | null {
  const lower = text.toLowerCase();
  if (lower.includes('poll') || lower.includes('vote') || lower.includes('feature') || lower.includes('ship first')) {
    return {
      blockName: 'poll',
      intro: "Voting helps me prioritize. I'll render a poll inline — pick an option and your vote becomes the next user message.",
      props: {
        question: 'Which feature should we ship first?',
        options: ['Branch-aware conversation DAG', 'Embedded Pyodide execution', 'Power-user keybindings'],
      },
    };
  }
  if (lower.includes('date') || lower.includes('meeting') || lower.includes('schedule')) {
    return {
      blockName: 'datePicker',
      intro: "Pick a slot — the date-picker block invokes a `book_slot` tool directly without producing a visible user message.",
      props: {
        prompt: 'Pick a 30-minute slot:',
        dates: ['Tue 2026-05-26 10:00', 'Wed 2026-05-27 14:30', 'Fri 2026-05-29 09:00'],
      },
    };
  }
  return null;
}

function findLastUserText(history: Message[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === 'user') return m.text;
  }
  return '';
}

function findToolMessages(history: Message[]) {
  return history.filter((m): m is Extract<Message, { role: 'tool' }> => m.role === 'tool' && !!m.toolCall);
}

export const generativeUiTransport: Transport = (text, history, signal) => {
  return makeSSEResponse(async function* (sig) {
    const toolMessages = findToolMessages(history);
    const lastToolMessage = toolMessages[toolMessages.length - 1];

    // Tool-continuation pass: respond to a freshly executed tool.
    if (!text && lastToolMessage) {
      if (lastToolMessage.toolCall.name === 'book_slot') {
        const slot = (lastToolMessage.toolCall.output as { confirmation?: string } | undefined)?.confirmation ?? 'your slot';
        yield* streamTextTokens(`✅ ${slot}. I’ll send the calendar invite shortly.`, sig);
        yield sseDone();
        return;
      }
      if (lastToolMessage.toolCall.name === 'get_weather') {
        const userPrompt = findLastUserText(history);
        const location = /in ([A-Z][\w\s]+)/i.exec(userPrompt)?.[1]?.trim() ?? 'Tokyo';
        yield* streamTextTokens(`It's currently **22 °C and partly cloudy** in ${location}.`, sig);
        yield sseDone();
        return;
      }
    }

    // Weather prompt → real tool call so the custom loader renders.
    if (text.toLowerCase().includes('weather')) {
      const location = /in ([A-Z][\w\s]+)/i.exec(text)?.[1]?.trim() ?? 'Tokyo';
      yield* streamTextTokens(`Looking up the current weather in ${location}…`, sig);
      await sleep(DEMO_CHUNK_DELAY_MS * 8, sig);
      yield sseLine(makeOpenAIToolCallChunk({
        id: `call_weather_${Date.now()}`,
        name: 'get_weather',
        input: { location, units: 'metric' },
      }, 0));
      yield sseDone();
      return;
    }

    // Generative-UI block prompt → __render_block tool call mapped to message.block.
    const plan = planForPrompt(text);
    if (plan) {
      yield* streamTextTokens(plan.intro, sig);
      await sleep(DEMO_CHUNK_DELAY_MS * 3, sig);
      yield sseLine(makeOpenAIToolCallChunk({
        id: `call_block_${Date.now()}`,
        name: RESERVED_BLOCK_TOOL_NAME,
        input: { name: plan.blockName, props: plan.props },
      }, 0));
      yield sseDone();
      return;
    }

    yield* streamTextTokens(
      "Try one of the suggested prompts — each one emits either a `__render_block` tool call (mapped to `message.block`) or a regular tool call wearing a custom loader.",
      sig,
    );
    yield sseDone();
  }, signal);
};
