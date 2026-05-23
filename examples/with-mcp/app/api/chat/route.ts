import { encodeSSEDone, encodeSSEEvent, sseHeaders } from 'react-chorus/server';
import type { Message } from 'react-chorus';

export const runtime = 'nodejs';
export const maxDuration = 60;

function latestUserText(history: Message[]) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message.role === 'user') return message.text;
  }
  return '';
}

function latestToolOutput(history: Message[]) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message.role === 'tool' && 'output' in message.toolCall) return message.toolCall.output;
  }
  return undefined;
}

function textChunk(text: string) {
  return { choices: [{ index: 0, delta: { content: text } }] };
}

function toolCallChunk(name: string, input: Record<string, unknown>) {
  return {
    choices: [{
      index: 0,
      delta: {
        tool_calls: [{
          index: 0,
          id: `call_${Date.now()}`,
          function: {
            name,
            arguments: JSON.stringify(input),
          },
        }],
      },
    }],
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as { history?: unknown };
  const history = Array.isArray(body.history) ? (body.history as Message[]) : [];
  const toolOutput = latestToolOutput(history);
  const prompt = latestUserText(history);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (toolOutput !== undefined) {
        controller.enqueue(encodeSSEEvent(textChunk(`The MCP tool returned:\n\n${JSON.stringify(toolOutput, null, 2)}`)));
      } else if (/echo|tool|mcp/i.test(prompt)) {
        controller.enqueue(encodeSSEEvent(textChunk('Calling the local MCP everything server now.')));
        controller.enqueue(encodeSSEEvent(toolCallChunk('everything:echo', { message: prompt || 'hello from Chorus' })));
      } else {
        controller.enqueue(encodeSSEEvent(textChunk('This demo uses the browser-side MCP client. Start the everything server, then ask me to call the MCP echo tool or type /everything: to see MCP prompts.')));
      }
      controller.enqueue(encodeSSEDone());
      controller.close();
    },
  });

  return new Response(stream, { headers: sseHeaders });
}
