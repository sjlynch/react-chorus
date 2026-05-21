import { makeOpenAIErrorChunk, makeOpenAIToolCallChunk, type OpenAIToolCallChunkSpec } from './openAIChunkBuilders';
import { DEMO_CHUNK_DELAY_MS, sleep, sseDone, sseLine, streamReasoningTokens, streamTextTokens } from './sseUtils';

export type DemoStreamToolCall = OpenAIToolCallChunkSpec;

export interface OpenAIDemoStreamPlan {
  reasoning?: string;
  toolCalls?: DemoStreamToolCall[];
  text?: string;
  /** Emit an OpenAI-shape in-band error after a brief delay. */
  errorMessage?: string;
  errorType?: string;
}

interface OpenAIDemoStreamTiming {
  toolCallDelayMultiplier?: number;
  afterToolCallsDelayMultiplier?: number;
  errorDelayMultiplier?: number;
}

export async function* streamOpenAIDemoPlan(
  plan: OpenAIDemoStreamPlan,
  signal: AbortSignal,
  timing: OpenAIDemoStreamTiming = {},
): AsyncGenerator<string> {
  if (plan.reasoning) yield* streamReasoningTokens(plan.reasoning, signal);

  if (plan.toolCalls?.length) {
    for (const [i, call] of plan.toolCalls.entries()) {
      await sleep(DEMO_CHUNK_DELAY_MS * (timing.toolCallDelayMultiplier ?? 2), signal);
      yield sseLine(makeOpenAIToolCallChunk(call, i));
    }
    await sleep(DEMO_CHUNK_DELAY_MS * (timing.afterToolCallsDelayMultiplier ?? 3), signal);
  }

  if (plan.errorMessage) {
    await sleep(DEMO_CHUNK_DELAY_MS * (timing.errorDelayMultiplier ?? 6), signal);
    yield sseLine(makeOpenAIErrorChunk(plan.errorMessage, plan.errorType));
    return;
  }

  if (plan.text) yield* streamTextTokens(plan.text, signal);

  yield sseDone();
}
