// react-chorus/headless — all components with zero default styles.
// CSS class names are preserved as semantic hooks for consumer styling.
// Markdown-backed components default to headless rendering so they do not
// inject <style> tags or syntax-highlight theme CSS unless explicitly opted in.

import React from 'react';
import {
  ChatWindow as BaseChatWindow,
  MessageBubble as BaseMessageBubble,
  type ChatWindowProps,
  type MessageBubbleProps,
} from './components/ChatWindow';
import { ConversationList as BaseConversationList, type ConversationListProps } from './components/ConversationList';
import { Markdown as BaseMarkdown, type MarkdownProps } from './components/Markdown';

// Keep the non-overridden headless public API in lockstep with the root entry.
export * from './index';

function ChatWindowInner<TMeta = Record<string, unknown>>(
  { headless = true, ...props }: ChatWindowProps<TMeta>,
  ref: React.ForwardedRef<HTMLDivElement>,
) {
  return React.createElement(BaseChatWindow<TMeta>, { ...props, ref, headless });
}

export const ChatWindow = React.forwardRef(ChatWindowInner) as <TMeta = Record<string, unknown>>(
  props: ChatWindowProps<TMeta> & React.RefAttributes<HTMLDivElement>,
) => React.ReactElement | null;

export function MessageBubble<TMeta = Record<string, unknown>>({ headless = true, ...props }: MessageBubbleProps<TMeta>) {
  return React.createElement(BaseMessageBubble<TMeta>, { ...props, headless });
}

export function Markdown({ headless = true, ...props }: MarkdownProps) {
  return React.createElement(BaseMarkdown, { ...props, headless });
}

export function ConversationList({ headless = true, ...props }: ConversationListProps) {
  return React.createElement(BaseConversationList, { ...props, headless });
}

// ChorusHeadless is Chorus with headless defaulting to true.
export { ChorusHeadless as Chorus, ChorusHeadless } from './ChorusHeadless';
export type { ChorusHeadlessProps, ChorusHeadlessProps as ChorusProps } from './ChorusHeadless';
