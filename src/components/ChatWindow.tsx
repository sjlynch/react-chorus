import React from 'react';
import type { Message } from '../types';
import { Markdown } from './Markdown';
import { ToolCallBlock } from './ToolCallBlock';

export interface ChatWindowProps {
  messages: Message[];
  typing?: boolean;
  codeTheme?: 'dark' | 'light';
  renderMessage?: (message: Message) => React.ReactNode;
}

export function ChatWindow({ messages, typing, codeTheme = 'dark', renderMessage }: ChatWindowProps) {
  return (
    <div className="chorus-window">
      {messages.map(m => {
        const custom = renderMessage?.(m);
        if (custom != null) return <React.Fragment key={m.id}>{custom}</React.Fragment>;

        if (m.role === 'tool' && m.toolCall) {
          return (
            <div key={m.id} className="chorus-msg chorus-tool">
              <ToolCallBlock toolCall={m.toolCall} />
            </div>
          );
        }

        return (
          <div key={m.id} className={`chorus-msg chorus-${m.role}`}>
            <div className="chorus-bubble"><Markdown text={m.text} codeTheme={codeTheme} /></div>
          </div>
        );
      })}
      {typing &&
        <div className="chorus-msg chorus-assistant chorus-typing">
          <div className="chorus-bubble"><span className="chorus-dot"></span><span className="chorus-dot"></span><span className="chorus-dot"></span></div>
        </div>
      }
    </div>
  );
}
