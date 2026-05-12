import React from 'react';
import { ArrowUp, Paperclip, X } from 'lucide-react';
import type { Attachment } from '../types';

const MAX_HEIGHT = 160;

export interface ChatInputProps {
  value: string;
  onChange: (v: string) => void;
  onSend: (attachments: Attachment[]) => void;
  onStop?: () => void;
  placeholder?: string;
  sending?: boolean;
  accept?: string;
}

export function ChatInput({ value, onChange, onSend, onStop, placeholder, sending, accept }: ChatInputProps) {
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const canSend = value.trim().length > 0 || attachments.length > 0;
  const showAttachBtn = accept !== undefined;

  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + 'px';
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    resizeTextarea();
  };

  const handleSend = () => {
    onSend(attachments);
    setAttachments([]);
    const el = textareaRef.current;
    if (el) el.style.height = '';
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sending && canSend) handleSend();
    }
  };

  const handleClick = () => {
    if (sending) { onStop?.(); }
    else if (canSend) { handleSend(); }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments(prev => [...prev, { name: file.name, type: file.type, data: reader.result as string, size: file.size }]);
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (idx: number) => setAttachments(prev => prev.filter((_, i) => i !== idx));

  return (
    <div className="chorus-input">
      {attachments.length > 0 && (
        <div className="chorus-attachments">
          {attachments.map((att, i) => (
            <div key={i} className="chorus-attachment-chip">
              {att.type.startsWith('image/') && (
                <img src={att.data} alt={att.name} className="chorus-attachment-thumb" />
              )}
              <span className="chorus-attachment-name">{att.name}</span>
              <button type="button" className="chorus-attachment-remove" onClick={() => removeAttachment(i)} aria-label={`Remove ${att.name}`}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className={`chorus-input-row${showAttachBtn ? ' chorus-input-row--has-attach' : ''}`}>
        {showAttachBtn && (
          <input ref={fileInputRef} type="file" accept={accept} multiple style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
        )}
        {showAttachBtn && (
          <button type="button" className="chorus-attach" onClick={() => fileInputRef.current?.click()} aria-label="Attach file" title="Attach file">
            <Paperclip size={18} strokeWidth={2} />
          </button>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={onKeyDown}
          placeholder={placeholder || 'Send a message'}
          aria-label={placeholder || 'Send a message'}
        />
        <button type="button" className="chorus-send" onClick={handleClick} aria-label={sending ? 'Stop' : 'Send'} title={sending ? 'Stop' : 'Send'} disabled={!sending && !canSend}>
          {sending ? <span className="chorus-stop-fill" /> : <ArrowUp size={18} strokeWidth={2} />}
        </button>
      </div>
    </div>
  );
}
