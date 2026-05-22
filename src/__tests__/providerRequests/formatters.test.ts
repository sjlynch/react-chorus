import { describe, expect, it } from 'vitest';
import {
  formatAiSdkModelMessagesBody,
  formatAnthropicMessagesBody,
  formatGeminiGenerateContentBody,
  formatOpenAIChatCompletionsBody,
  formatOpenAIResponsesBody,
  toAiSdkModelMessagesBody,
  toAnthropicMessagesBody,
  toGeminiGenerateContentBody,
  toOpenAIChatCompletionsBody,
  toOpenAIResponsesBody,
} from '../../providerRequests';
import { history } from './fixtures';

describe('provider request formatBody helpers', () => {
  it('returns JSON formatBody helpers for createFetchSSETransport', () => {
    const messages = history();
    expect(JSON.parse(String(formatOpenAIChatCompletionsBody({ model: 'gpt-4o-mini' })('ignored', messages)))).toEqual(
      toOpenAIChatCompletionsBody(messages, { model: 'gpt-4o-mini' }),
    );
    expect(JSON.parse(String(formatOpenAIResponsesBody({ model: 'gpt-4.1-mini' })('ignored', messages)))).toEqual(
      toOpenAIResponsesBody(messages, { model: 'gpt-4.1-mini' }),
    );
    expect(JSON.parse(String(formatAiSdkModelMessagesBody({ temperature: 0.2 })('ignored', messages)))).toEqual(
      toAiSdkModelMessagesBody(messages, { temperature: 0.2 }),
    );
    expect(JSON.parse(String(formatAnthropicMessagesBody({ model: 'claude-sonnet-4-6', max_tokens: 512 })('ignored', messages)))).toEqual(
      toAnthropicMessagesBody(messages, { model: 'claude-sonnet-4-6', max_tokens: 512 }),
    );
    expect(JSON.parse(String(formatGeminiGenerateContentBody({ generationConfig: { temperature: 0.2 } })('ignored', messages)))).toEqual(
      toGeminiGenerateContentBody(messages, { generationConfig: { temperature: 0.2 } }),
    );
  });
});
