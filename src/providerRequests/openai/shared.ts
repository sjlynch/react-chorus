import type { Message } from '../../types';
import { metadataString } from '../metadata';

export function openAIToolCallId(message: Message<unknown>) {
  return metadataString(message, 'openai', ['toolCallId', 'tool_call_id', 'callId', 'call_id'], [
    'openaiToolCallId',
    'openai_tool_call_id',
    'toolCallId',
    'tool_call_id',
    'callId',
    'call_id',
    'providerToolCallId',
  ]);
}
