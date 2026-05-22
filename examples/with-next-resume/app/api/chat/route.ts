import OpenAI from 'openai';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';
import { toOpenAIChatCompletionsBody } from 'react-chorus/provider-requests';
import { encodeSSEDone, encodeSSEError, encodeSSEEvent, sseHeaders } from 'react-chorus/server';
import type { Message } from 'react-chorus';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Chorus POSTs `{ prompt, history }`. `history` already includes both
        // the server-seeded transcript and the new user turn, so the server
        // proxy maps `history` directly and ignores `prompt`.
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
          controller.enqueue(encodeSSEEvent(chunk));
        }

        controller.enqueue(encodeSSEDone());
      } catch (error) {
        if (!request.signal.aborted) {
          controller.enqueue(encodeSSEError(error));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders });
}
