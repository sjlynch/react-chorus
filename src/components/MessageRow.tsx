import React from 'react';
import { Check, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import type { Attachment, Message } from '../types';
import { Markdown } from './Markdown';

function isRenderableAttachmentSource(src: string | undefined) {
  return !!src && /^(data:|blob:|https?:)/i.test(src);
}

function getAttachmentPreviewSource(att: Attachment) {
  const source = att.url ?? att.data;
  return isRenderableAttachmentSource(source) ? source : undefined;
}

function MessageAttachments({ attachments }: { attachments?: Attachment[] }) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="chorus-msg-attachments">
      {attachments.map((att, i) => {
        const previewSource = getAttachmentPreviewSource(att);
        return att.type.startsWith('image/') && previewSource
          ? <img key={i} src={previewSource} alt={att.name} className="chorus-msg-img" />
          : <span key={i} className="chorus-msg-file">{att.name}</span>;
      })}
    </div>
  );
}

export interface MessageBubbleProps<TMeta = Record<string, unknown>> {
  message: Message<TMeta>;
  className?: string;
  style?: React.CSSProperties;
  codeTheme?: 'dark' | 'light';
  headless?: boolean;
  streaming?: boolean;
}

function MessageBubbleLayout<TMeta = Record<string, unknown>>({ message, codeTheme, headless, streaming = false, children }: {
  message: Message<TMeta>;
  codeTheme: 'dark' | 'light';
  headless?: boolean;
  streaming?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="chorus-msg-content">
      <div className="chorus-bubble">
        <MessageAttachments attachments={message.attachments} />
        <Markdown text={message.text} codeTheme={codeTheme} headless={headless} streaming={streaming} />
      </div>
      {children}
    </div>
  );
}

export function MessageBubble<TMeta = Record<string, unknown>>({ message, className, style, codeTheme = 'dark', headless, streaming = false }: MessageBubbleProps<TMeta>) {
  const cls = ['chorus-msg', `chorus-${message.role}`, className].filter(Boolean).join(' ');
  return (
    <div className={cls} style={style}>
      <MessageBubbleLayout message={message} codeTheme={codeTheme} headless={headless ?? false} streaming={streaming} />
    </div>
  );
}

export interface MessageRowProps<TMeta = Record<string, unknown>> {
  m: Message<TMeta>;
  codeTheme: 'dark' | 'light';
  headless?: boolean;
  onEdit?: (id: string, newText: string) => void;
  onRegenerate?: (id: string) => void;
  onDelete?: (id: string) => void;
  streaming?: boolean;
}

export function MessageRow<TMeta = Record<string, unknown>>({ m, codeTheme, headless, onEdit, onRegenerate, onDelete, streaming = false }: MessageRowProps<TMeta>) {
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
            aria-label="Edit message"
            value={editText}
            onChange={e => setEditText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(); }
              if (e.key === 'Escape') cancelEdit();
            }}
          />
          <div className="chorus-edit-actions">
            <button type="button" className="chorus-action-btn" onClick={submitEdit} title="Save" aria-label="Save"><Check size={14} /></button>
            <button type="button" className="chorus-action-btn" onClick={cancelEdit} title="Cancel" aria-label="Cancel"><X size={14} /></button>
          </div>
        </div>
      ) : (
        <MessageBubbleLayout message={m} codeTheme={codeTheme} headless={headless} streaming={streaming}>
          {hasActions && (
            <div className="chorus-actions">
              {m.role === 'user' && onEdit && (
                <button type="button" className="chorus-action-btn" onClick={() => { setEditText(m.text); setEditing(true); }} title="Edit" aria-label="Edit"><Pencil size={13} /></button>
              )}
              {m.role === 'assistant' && onRegenerate && (
                <button type="button" className="chorus-action-btn" onClick={() => onRegenerate(m.id)} title="Regenerate" aria-label="Regenerate"><RefreshCw size={13} /></button>
              )}
              {onDelete && (
                <button type="button" className="chorus-action-btn" onClick={() => onDelete(m.id)} title="Delete" aria-label="Delete"><Trash2 size={13} /></button>
              )}
            </div>
          )}
        </MessageBubbleLayout>
      )}
    </div>
  );
}
