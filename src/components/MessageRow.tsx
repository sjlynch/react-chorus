import React from 'react';
import { Check, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import type { Attachment, Message } from '../types';
import { Markdown, type MarkdownProps, type MarkdownSanitizer } from './Markdown';

export type MessageMarkdownProps = Omit<MarkdownProps, 'text' | 'codeTheme' | 'headless' | 'streaming'>;

export interface MessageRenderActions {
  canEdit: boolean;
  canRegenerate: boolean;
  canDelete: boolean;
  edit?: (newText: string) => void;
  regenerate?: () => void;
  delete?: () => void;
  defaultRender: () => React.ReactNode;
}

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

export interface MessageBubbleProps<TMeta = Record<string, unknown>> {
  message: Message<TMeta>;
  className?: string;
  style?: React.CSSProperties;
  codeTheme?: 'dark' | 'light';
  headless?: boolean;
  streaming?: boolean;
  markdownProps?: MessageMarkdownProps;
  markdownSanitizer?: MarkdownSanitizer;
}

function MessageBubbleLayout<TMeta = Record<string, unknown>>({ message, codeTheme, headless, streaming = false, markdownProps, markdownSanitizer, children }: {
  message: Message<TMeta>;
  codeTheme: 'dark' | 'light';
  headless?: boolean;
  streaming?: boolean;
  markdownProps?: MessageMarkdownProps;
  markdownSanitizer?: MarkdownSanitizer;
  children?: React.ReactNode;
}) {
  return (
    <div className="chorus-msg-content">
      <div className="chorus-bubble">
        <MessageAttachments attachments={message.attachments} />
        <Markdown {...markdownProps} text={message.text} codeTheme={codeTheme} headless={headless} streaming={streaming} sanitizer={markdownSanitizer ?? markdownProps?.sanitizer} />
      </div>
      {children}
    </div>
  );
}

export function MessageBubble<TMeta = Record<string, unknown>>({ message, className, style, codeTheme = 'dark', headless, streaming = false, markdownProps, markdownSanitizer }: MessageBubbleProps<TMeta>) {
  const cls = ['chorus-msg', `chorus-${message.role}`, className].filter(Boolean).join(' ');
  return (
    <div className={cls} style={style}>
      <MessageBubbleLayout message={message} codeTheme={codeTheme} headless={headless ?? false} streaming={streaming} markdownProps={markdownProps} markdownSanitizer={markdownSanitizer} />
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
  markdownProps?: MessageMarkdownProps;
  markdownSanitizer?: MarkdownSanitizer;
}

export function MessageActionControls<TMeta = Record<string, unknown>>({ message, actions }: { message: Message<TMeta>; actions: MessageRenderActions }) {
  const [editing, setEditing] = React.useState(false);
  const [editText, setEditText] = React.useState(message.text);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const hasActions = actions.canEdit || actions.canRegenerate || actions.canDelete;

  React.useEffect(() => {
    if (editing && textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      el.selectionStart = el.value.length;
    }
  }, [editing]);

  const submitEdit = () => {
    const trimmed = editText.trim();
    if (trimmed && actions.edit) actions.edit(trimmed);
    setEditing(false);
  };

  const cancelEdit = () => {
    setEditText(message.text);
    setEditing(false);
  };

  if (!hasActions) return null;

  if (editing) {
    return (
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
    );
  }

  return (
    <div className="chorus-actions">
      {actions.canEdit && actions.edit && (
        <button type="button" className="chorus-action-btn" onClick={() => { setEditText(message.text); setEditing(true); }} title="Edit" aria-label="Edit"><Pencil size={13} /></button>
      )}
      {actions.canRegenerate && actions.regenerate && (
        <button type="button" className="chorus-action-btn" onClick={actions.regenerate} title="Regenerate" aria-label="Regenerate"><RefreshCw size={13} /></button>
      )}
      {actions.canDelete && actions.delete && (
        <button type="button" className="chorus-action-btn" onClick={actions.delete} title="Delete" aria-label="Delete"><Trash2 size={13} /></button>
      )}
    </div>
  );
}

export function MessageRow<TMeta = Record<string, unknown>>({ m, codeTheme, headless, onEdit, onRegenerate, onDelete, streaming = false, markdownProps, markdownSanitizer }: MessageRowProps<TMeta>) {
  const [editing, setEditing] = React.useState(false);
  const [editText, setEditText] = React.useState(m.text);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const hasActions = Boolean((m.role === 'user' && onEdit) || (m.role === 'assistant' && onRegenerate) || onDelete);

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
        <MessageBubbleLayout message={m} codeTheme={codeTheme} headless={headless} streaming={streaming} markdownProps={markdownProps} markdownSanitizer={markdownSanitizer}>
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
