import React from 'react';

export function ChatWindow({ messages }: { messages: { id: string; role: 'user' | 'assistant'; text: string }[] }) {
  return (
    <div className="chorus-window">
      {messages.map(m => <div key={m.id} className={`chorus-msg chorus-${m.role}`}>{m.text}</div>)}
    </div>
  );
}
