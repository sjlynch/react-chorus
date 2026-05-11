import React from 'react';
import type { Message } from '../types';
import { Markdown } from './Markdown';
import { Pencil, RefreshCw, Trash2, Check, X } from 'lucide-react';

export interface ChatWindowProps {
  messages: Message[];
  typing?: boolean;
  codeTheme?: 'dark' | 'light';
  onEdit?: (id: string, newText: string) => void;
  onRegenerate?: (id: string) => void;
  onDelete?: (id: string) => void;
}

function MessageRow({ m, codeTheme, onEdit, onRegenerate, onDelete }: {
  m: Message;
  codeTheme: 'dark' | 'light';
  onEdit?: (id: string, newText: string) => void;
  onRegenerate?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
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
          <div className="chorus-bubble"><Markdown text={m.text} codeTheme={codeTheme} /></div>
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

export function ChatWindow({ messages, typing, codeTheme = 'dark', onEdit, onRegenerate, onDelete }: ChatWindowProps) {
  return (
    <div className="chorus-window">
      {messages.map(m => (
        <MessageRow key={m.id} m={m} codeTheme={codeTheme} onEdit={onEdit} onRegenerate={onRegenerate} onDelete={onDelete} />
      ))}
      {typing && (
        <div className="chorus-msg chorus-assistant chorus-typing">
          <div className="chorus-bubble"><span className="chorus-dot"></span><span className="chorus-dot"></span><span className="chorus-dot"></span></div>
        </div>
      )}
    </div>
  );
}
