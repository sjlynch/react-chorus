import React from 'react';

export interface ChatInputProps { value: string; onChange: (v: string) => void; onSend: () => void }

export function ChatInput({ value, onChange, onSend }: ChatInputProps) {
  return (
    <div className="chorus-input">
      <input value={value} onChange={e => onChange(e.target.value)} placeholder="Type a message..." />
      <button onClick={onSend}>Send</button>
    </div>
  );
}
