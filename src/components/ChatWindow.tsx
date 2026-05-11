import React from 'react';
import type { Message } from '../types';
import { Markdown } from './Markdown';

const HIDDEN_ROLES = new Set(['system', 'tool'] as const);

export function ChatWindow({ messages, typing, codeTheme = 'dark', showSystemMessages = false }: { messages: Message[]; typing?: boolean; codeTheme?: 'dark' | 'light'; showSystemMessages?: boolean }) {
  const visible = showSystemMessages ? messages : messages.filter(m => !HIDDEN_ROLES.has(m.role as 'system' | 'tool'));
  return (
    <div className="chorus-window">
      {visible.map(m =>
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
