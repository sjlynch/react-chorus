import React from 'react';
import type { Message } from '../types';
import { Markdown } from './Markdown';

export function ChatWindow({ messages, typing, codeTheme = 'dark' }: { messages: Message[]; typing?: boolean; codeTheme?: 'dark' | 'light' }) {
  return (
    <div className="chorus-window">
      {messages.map(m =>
        <div key={m.id} className={`chorus-msg chorus-${m.role}`}>
          <div className="chorus-bubble"><Markdown text={m.text} codeTheme={codeTheme} /></div>
        </div>
      )}
      {typing &&
        <div className="chorus-msg chorus-assistant chorus-typing">
          <div className="chorus-bubble"><span className="chorus-dot"></span><span className="chorus-dot"></span><span className="chorus-dot"></span></div>
        </div>
      }
    </div>
  );
}
