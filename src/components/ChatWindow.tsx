import React from 'react';
import type { Message } from '../types';
import { Markdown } from './Markdown';
import { Pencil, RefreshCw, Trash2, Check, X } from 'lucide-react';
import { ToolCallBlock } from './ToolCallBlock';

const HIDDEN_ROLES = new Set(['system', 'tool'] as const);

export interface ChatWindowProps {
  messages: Message[];
  typing?: boolean;
  codeTheme?: 'dark' | 'light';
  headless?: boolean;
  renderMessage?: (message: Message) => React.ReactNode;
  showSystemMessages?: boolean;
  onEdit?: (id: string, newText: string) => void;
  onRegenerate?: (id: string) => void;
  onDelete?: (id: string) => void;
  error?: string | null;
  onRetry?: () => void;
}

function MessageRow({ m, codeTheme, headless, onEdit, onRegenerate, onDelete }: {
  m: Message;
  codeTheme: 'dark' | 'light';
  headless?: boolean;
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
          <div className="chorus-bubble">
            {m.attachments && m.attachments.length > 0 && (
              <div className="chorus-msg-attachments">
                {m.attachments.map((att, i) => (
                  att.type.startsWith('image/')
                    ? <img key={i} src={att.data} alt={att.name} className="chorus-msg-img" />
                    : <span key={i} className="chorus-msg-file">{att.name}</span>
                ))}
              </div>
            )}
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

export interface MessageBubbleProps {
  message: Message;
  className?: string;
  style?: React.CSSProperties;
  codeTheme?: 'dark' | 'light';
}

export function MessageBubble({ message, className, style, codeTheme = 'dark' }: MessageBubbleProps) {
  const cls = ['chorus-msg', `chorus-${message.role}`, className].filter(Boolean).join(' ');
  return (
    <div className={cls} style={style}>
      <div className="chorus-bubble"><Markdown text={message.text} codeTheme={codeTheme} /></div>
    </div>
  );
}

export function ChatWindow({ messages, typing, codeTheme = 'dark', headless = false, renderMessage, showSystemMessages = false, onEdit, onRegenerate, onDelete, error, onRetry }: ChatWindowProps) {
  const visible = showSystemMessages ? messages : messages.filter(m => !HIDDEN_ROLES.has(m.role as 'system' | 'tool'));
  return (
    <div className="chorus-window">
      {visible.map(m => {
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
          <MessageRow key={m.id} m={m} codeTheme={codeTheme} headless={headless} onEdit={onEdit} onRegenerate={onRegenerate} onDelete={onDelete} />
        );
      })}

      {typing &&
        <div className="chorus-msg chorus-assistant chorus-typing">
          <div className="chorus-bubble"><span className="chorus-dot"></span><span className="chorus-dot"></span><span className="chorus-dot"></span></div>
        </div>
      }
      {error &&
        <div className="chorus-error">
          <span className="chorus-error-text">{error}</span>
          {onRetry && <button className="chorus-retry-btn" onClick={onRetry}>Retry</button>}
        </div>
      }
    </div>
  );
}
