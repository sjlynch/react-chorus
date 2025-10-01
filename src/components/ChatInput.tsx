import React from 'react';
import { ArrowUp } from 'lucide-react';

export interface ChatInputProps { value: string; onChange: (v: string) => void; onSend: () => void; onStop?: () => void; placeholder?: string; sending?: boolean }

export function ChatInput({ value, onChange, onSend, onStop, placeholder, sending }: ChatInputProps) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sending && value.trim()) onSend(); } };
  const handleClick = () => { if (sending) { onStop && onStop(); } else if (value.trim()) { onSend(); } };
  const disabled = !sending && !value.trim();

  return (
    <div className="chorus-input">
      <textarea value={value} onChange={e => onChange(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder || 'Send a message'} />
      <button type="button" className="chorus-send" onClick={handleClick} aria-label={sending ? 'Stop' : 'Send'} title={sending ? 'Stop' : 'Send'} disabled={disabled}>
        {sending ? <span className="chorus-stop-fill" /> : <ArrowUp size={18} strokeWidth={2} />}
      </button>
    </div>
  );
}
