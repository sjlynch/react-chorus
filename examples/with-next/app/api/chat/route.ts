import OpenAI from 'openai';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';
import { toOpenAIChatCompletionsBody } from 'react-chorus/provider-requests';
import type { Message } from 'react-chorus';

export const runtime = 'nodejs';
export const maxDuration = 60;

const encoder = new TextEncoder();

const sseHeaders = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no',
};

function encodeSSE(data: unknown) {
  return encoder.encode(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: Request) {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Chorus POSTs `{ prompt, history }`. `history` already includes the new
        // user turn — do not also append `body.prompt`, or the latest message
        // will be sent to the model twice. `prompt` is just a convenience copy.
        const body = (await request.json()) as { history?: unknown };
        const history = Array.isArray(body.history) ? (body.history as Message[]) : [];
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

        const openai = new OpenAI({ apiKey });
        const completionBody = {
          ...toOpenAIChatCompletionsBody(history, { model: 'gpt-4o-mini' }),
          stream: true,
        } satisfies ChatCompletionCreateParamsStreaming;

        const upstream = await openai.chat.completions.create(completionBody, { signal: request.signal });

        for await (const chunk of upstream) {
          controller.enqueue(encodeSSE(chunk));
        }

        controller.enqueue(encodeSSE('[DONE]'));
      } catch (error) {
        if (!request.signal.aborted) {
          controller.enqueue(encodeSSE({ error: getErrorMessage(error) }));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders });
}
