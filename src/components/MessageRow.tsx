import React from 'react';
import { Check, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import type { Attachment, Message } from '../types';
import { Markdown } from './Markdown';

function MessageAttachments({ attachments }: { attachments?: Attachment[] }) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="chorus-msg-attachments">
      {attachments.map((att, i) => (
        att.type.startsWith('image/')
          ? <img key={i} src={att.data} alt={att.name} className="chorus-msg-img" />
          : <span key={i} className="chorus-msg-file">{att.name}</span>
      ))}
    </div>
  );
}

export interface MessageBubbleProps {
  message: Message;
  className?: string;
  style?: React.CSSProperties;
  codeTheme?: 'dark' | 'light';
  headless?: boolean;
}

export function MessageBubble({ message, className, style, codeTheme = 'dark', headless }: MessageBubbleProps) {
  const cls = ['chorus-msg', `chorus-${message.role}`, className].filter(Boolean).join(' ');
  return (
    <div className={cls} style={style}>
      <div className="chorus-bubble">
        <MessageAttachments attachments={message.attachments} />
        <Markdown text={message.text} codeTheme={codeTheme} headless={headless ?? false} />
      </div>
    </div>
  );
}

export interface MessageRowProps {
  m: Message;
  codeTheme: 'dark' | 'light';
  headless?: boolean;
  onEdit?: (id: string, newText: string) => void;
  onRegenerate?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export function MessageRow({ m, codeTheme, headless, onEdit, onRegenerate, onDelete }: MessageRowProps) {
  const [editing, setEditing] = React.useState(false);
  const [editText, setEditText] = React.useState(m.text);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const hasActions = onEdit || onRegenerate || onDelete;

  React.useEffect(() => {
    if (editing && textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      el.selectionStart = el.value.length;
    }
  }, [editing]);

  const submitEdit = () => {
    const trimmed = editText.trim();
    if (trimmed && onEdit) onEdit(m.id, trimmed);
    setEditing(false);
  };

  const cancelEdit = () => {
    setEditText(m.text);
    setEditing(false);
  };

  return (
    <div className={`chorus-msg chorus-${m.role}`}>
      {editing ? (
        <div className="chorus-edit-wrap">
          <textarea
            ref={textareaRef}
            className="chorus-edit-textarea"
            value={editText}
            onChange={e => setEditText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(); }
              if (e.key === 'Escape') cancelEdit();
            }}
          />
          <div className="chorus-edit-actions">
            <button type="button" className="chorus-action-btn" onClick={submitEdit} title="Save"><Check size={14} /></button>
            <button type="button" className="chorus-action-btn" onClick={cancelEdit} title="Cancel"><X size={14} /></button>
          </div>
        </div>
      ) : (
        <div className="chorus-msg-content">
          <div className="chorus-bubble">
            <MessageAttachments attachments={m.attachments} />
            <Markdown text={m.text} codeTheme={codeTheme} headless={headless} />
          </div>
          {hasActions && (
            <div className="chorus-actions">
              {m.role === 'user' && onEdit && (
                <button type="button" className="chorus-action-btn" onClick={() => { setEditText(m.text); setEditing(true); }} title="Edit"><Pencil size={13} /></button>
              )}
              {m.role === 'assistant' && onRegenerate && (
                <button type="button" className="chorus-action-btn" onClick={() => onRegenerate(m.id)} title="Regenerate"><RefreshCw size={13} /></button>
              )}
              {onDelete && (
                <button type="button" className="chorus-action-btn" onClick={() => onDelete(m.id)} title="Delete"><Trash2 size={13} /></button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
