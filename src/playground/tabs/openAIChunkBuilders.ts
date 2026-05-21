export interface OpenAIToolCallChunkSpec {
  index?: number;
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Playground-only connector extension consumed by the OpenAI connector. */
  output?: unknown;
}

interface OpenAIToolCallDelta {
  index: number;
  id: string;
  function: {
    name: string;
    arguments: string;
  };
  output?: unknown;
}

export function makeOpenAIToolCallChunk(call: OpenAIToolCallChunkSpec, fallbackIndex = 0): unknown {
  const toolCall: OpenAIToolCallDelta = {
    index: call.index ?? fallbackIndex,
    id: call.id,
    function: {
      name: call.name,
      arguments: JSON.stringify(call.input),
    },
  };

  if ('output' in call) toolCall.output = call.output;

  return {
    choices: [{
      index: 0,
      delta: {
        tool_calls: [toolCall],
      },
    }],
  };
}

export function makeOpenAIErrorChunk(message: string, type = 'demo_error'): unknown {
  return { error: { message, type } };
}
