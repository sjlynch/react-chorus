import { ChatWindow, MessageBubble, stringActivityKey } from '../../components/ChatWindow';
import type { Message } from '../../types';
import type { RenderMessageContext } from '../../components/ChatWindow';

export { ChatWindow, MessageBubble, stringActivityKey };
export type { MessageFeedback, RenderMessageContext } from '../../components/ChatWindow';
export type { Message } from '../../types';

export const USER_MSG: Message = { id: 'u1', role: 'user', text: 'Hello' };
export const ASST_MSG: Message = { id: 'a1', role: 'assistant', text: 'Hi there' };
export const SYS_MSG: Message = { id: 's1', role: 'system', text: 'You are helpful.' };
export const TOOL_MSG: Message = {
  id: 't1',
  role: 'tool',
  text: '',
  toolCall: { name: 'search', input: { q: 'test' }, output: 'results' },
};

export function readmeMessageRenderer(msg: Message, ctx: RenderMessageContext) {
  return (
    <>
      <MessageBubble message={msg} streaming={ctx.isStreaming} />
      {ctx.actions.defaultRender()}
    </>
  );
}

export function containsLoneSurrogate(value: string) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (i + 1 >= value.length || next < 0xdc00 || next > 0xdfff) return true;
      i += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}
