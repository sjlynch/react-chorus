import type { Transport } from '../../hooks/useChorusStream';
import { DEMO_CHUNK_DELAY_MS, makeSSEResponse, sleep, sseDone, sseLine } from './sseUtils';

/**
 * Mock OpenAI Chat Completions SSE — tokenized text + a trailing `usage`
 * frame so the cost meter renders real numbers per turn.
 */
export const mockOpenAITransport: Transport = (text, _history, signal) => {
  const reply = `(gpt-4o-mini) ${shortReply(text)}`;
  return makeSSEResponse(async function* (sig) {
    for (const token of tokens(reply)) {
      await sleep(DEMO_CHUNK_DELAY_MS, sig);
      yield sseLine({ choices: [{ index: 0, delta: { content: token } }] });
    }
    yield sseLine({
      choices: [],
      usage: { prompt_tokens: 38 + text.length, completion_tokens: reply.length, total_tokens: 38 + text.length + reply.length },
    });
    yield sseDone();
  }, signal);
};

/**
 * Mock Anthropic Messages SSE — `content_block_delta` text events plus a
 * `message_delta` carrying `usage` and a `message_stop` terminator.
 */
export const mockAnthropicTransport: Transport = (text, _history, signal) => {
  const reply = `(claude-3-5-sonnet) ${shortReply(text)}`;
  return makeSSEResponse(async function* (sig) {
    for (const token of tokens(reply)) {
      await sleep(DEMO_CHUNK_DELAY_MS, sig);
      yield sseLine({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: token },
      });
    }
    yield sseLine({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { input_tokens: 38 + text.length, output_tokens: reply.length },
    });
    yield sseLine({ type: 'message_stop' });
  }, signal);
};

/**
 * Mock Gemini generateContent SSE — `candidates[].content.parts[].text` plus
 * a final `usageMetadata` block on the terminating chunk.
 */
export const mockGeminiTransport: Transport = (text, _history, signal) => {
  const reply = `(gemini-2.5-flash) ${shortReply(text)}`;
  const all = tokens(reply);
  return makeSSEResponse(async function* (sig) {
    for (let i = 0; i < all.length; i++) {
      await sleep(DEMO_CHUNK_DELAY_MS, sig);
      const isLast = i === all.length - 1;
      const candidate: Record<string, unknown> = {
        index: 0,
        content: { parts: [{ text: all[i] }] },
      };
      if (isLast) candidate.finishReason = 'STOP';
      const payload: Record<string, unknown> = { candidates: [candidate] };
      if (isLast) {
        payload.usageMetadata = {
          promptTokenCount: 38 + text.length,
          candidatesTokenCount: reply.length,
          totalTokenCount: 38 + text.length + reply.length,
        };
      }
      yield sseLine(payload);
    }
  }, signal);
};

function tokens(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [text];
}

function shortReply(prompt: string): string {
  const trimmed = prompt.trim().slice(0, 80);
  return `You said: "${trimmed}". This reply streamed through the matching connector and the trailing usage frame fed the cost meter.`;
}
