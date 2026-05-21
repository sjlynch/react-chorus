import { describe, expect, it } from 'vitest';
import {
  toAnthropicMessagesBody,
  toGeminiGenerateContentBody,
  toOpenAIChatCompletionsBody,
  toOpenAIResponsesBody,
} from '../../providerRequests';
import { emptyDataHistory } from './fixtures';

describe('provider request attachment fallback behavior', () => {
  it('falls back to text for image attachments whose data URL has an empty base64 payload', () => {
    expect(toOpenAIChatCompletionsBody(emptyDataHistory()).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe' },
          { type: 'text', text: '[Unsupported attachment omitted: stub.png (image/png)]' },
        ],
      },
    ]);

    expect(toOpenAIResponsesBody(emptyDataHistory()).input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Describe' },
          { type: 'input_text', text: '[Unsupported attachment omitted: stub.png (image/png)]' },
        ],
      },
    ]);

    expect(toAnthropicMessagesBody(emptyDataHistory()).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe' },
          { type: 'text', text: '[Unsupported attachment omitted: stub.png (image/png)]' },
        ],
      },
    ]);

    expect(toGeminiGenerateContentBody(emptyDataHistory()).contents).toEqual([
      {
        role: 'user',
        parts: [
          { text: 'Describe' },
          { text: '[Unsupported attachment omitted: stub.png (image/png)]' },
        ],
      },
    ]);
  });
});
