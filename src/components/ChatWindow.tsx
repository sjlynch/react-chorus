import React from 'react';
import type { Message } from '../types';
import { Markdown } from './Markdown';

export interface MessageBubbleProps {
  message: Message;
  className?: string;
  style?: React.CSSProperties;
  codeTheme?: 'dark' | 'light';
}

export function MessageBubble({ message, className, style, codeTheme = 'dark' }: MessageBubbleProps) {
  const cls = ['chorus-msg', `chorus-${message.role}`, className].filter(Boolean).join(' ');
  return (
    <div className={cls} style={style}>
      <div className="chorus-bubble"><Markdown text={message.text} codeTheme={codeTheme} /></div>
    </div>
  );
}

export interface ChatWindowProps {
  messages: Message[];
  typing?: boolean;
  codeTheme?: 'dark' | 'light';
  renderMessage?: (message: Message) => React.ReactNode;
}

export function ChatWindow({ messages, typing, codeTheme = 'dark', renderMessage }: ChatWindowProps) {
  return (
    <div className="chorus-window">
      {messages.map(m =>
        <React.Fragment key={m.id}>
          {renderMessage
            ? renderMessage(m)
            : <MessageBubble message={m} codeTheme={codeTheme} />}
        </React.Fragment>
      )}
      {typing &&
        <div className="chorus-msg chorus-assistant chorus-typing">
          <div className="chorus-bubble"><span className="chorus-dot"></span><span className="chorus-dot"></span><span className="chorus-dot"></span></div>
        </div>
      }
    </div>
  );
}
