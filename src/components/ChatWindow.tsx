import React from 'react';
import type { Message } from '../types';

export function ChatWindow({ messages, typing }: { messages: Message[]; typing?: boolean }) {
  return (
    <div className="chorus-window">
      {messages.map(m =>
        <div key={m.id} className={`chorus-msg chorus-${m.role}`}>
          <div className="chorus-bubble" style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
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
