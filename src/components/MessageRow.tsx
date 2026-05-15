import React from 'react';
import { Check, Copy, Pencil, RefreshCw, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react';
import type { Attachment, Message, Role } from '../types';
import { getAttachmentPreviewSource } from '../utils/attachmentPreview';
import { canWriteTextToClipboard, writeTextToClipboard } from '../utils/messageCopy';
import { Markdown, type MarkdownProps, type MarkdownSanitizer } from './Markdown';

export type MessageMarkdownProps = Omit<MarkdownProps, 'text' | 'codeTheme' | 'headless' | 'streaming'>;
export type MessageFeedback = 'up' | 'down';

export interface MessageBubbleSlots {
  before?: React.ReactNode;
  headerSlot?: React.ReactNode;
  footerSlot?: React.ReactNode;
  after?: React.ReactNode;
}

export interface MessageRenderActions {
  canEdit: boolean;
  canRegenerate: boolean;
  canDelete: boolean;
  edit?: (newText: string) => void;
  regenerate?: () => void;
  delete?: () => void;
  copy?: () => void;
  feedback?: (variant: MessageFeedback) => void;
  defaultRender: () => React.ReactNode;
}

interface MessageRenderStateValue {
  messageId: string;
  isEditing: boolean;
  setIsEditing: (editing: boolean) => void;
}

const MessageRenderStateContext = React.createContext<MessageRenderStateValue | null>(null);

export function MessageRenderStateProvider({ messageId, children }: { messageId: string; children: React.ReactNode }) {
  const [isEditing, setIsEditing] = React.useState(false);
  const value = React.useMemo(() => ({ messageId, isEditing, setIsEditing }), [messageId, isEditing]);

  return <MessageRenderStateContext.Provider value={value}>{children}</MessageRenderStateContext.Provider>;
}

function useActionEditing(messageId: string) {
  const renderState = React.useContext(MessageRenderStateContext);
  const [localEditing, setLocalEditing] = React.useState(false);

  if (renderState?.messageId === messageId) {
    return [renderState.isEditing, renderState.setIsEditing] as const;
  }

  return [localEditing, setLocalEditing] as const;
}

export function getMessageSpeakerLabel(role: Role) {
  switch (role) {
    case 'assistant':
      return 'Assistant message';
    case 'system':
      return 'System message';
    case 'tool':
      return 'Tool message';
    case 'user':
    default:
      return 'User message';
  }
}

export function MessageSpeakerLabel({ role }: { role: Role }) {
  return <span className="chorus-sr-only">{getMessageSpeakerLabel(role)}</span>;
}

function MessageAttachments({ attachments }: { attachments?: Attachment[] }) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="chorus-msg-attachments">
      {attachments.map((att, i) => {
        const previewSource = getAttachmentPreviewSource(att);
        return att.type.startsWith('image/') && previewSource
          ? <img key={i} src={previewSource} alt={att.name} className="chorus-msg-img" loading="lazy" decoding="async" />
          : <span key={i} className="chorus-msg-file">{att.name}</span>;
      })}
    </div>
  );
}

export interface MessageBubbleProps<TMeta = Record<string, unknown>> extends MessageBubbleSlots {
  message: Message<TMeta>;
  className?: string;
  style?: React.CSSProperties;
  codeTheme?: 'dark' | 'light';
  headless?: boolean;
  streaming?: boolean;
  markdownProps?: MessageMarkdownProps;
  markdownSanitizer?: MarkdownSanitizer;
}

function MessageReasoning({ reasoning, codeTheme, headless, streaming = false, markdownProps, markdownSanitizer }: {
  reasoning?: string;
  codeTheme: 'dark' | 'light';
  headless?: boolean;
  streaming?: boolean;
  markdownProps?: MessageMarkdownProps;
  markdownSanitizer?: MarkdownSanitizer;
}) {
  if (!reasoning) return null;

  return (
    <details className="chorus-reasoning">
      <summary className="chorus-reasoning-summary">Reasoning</summary>
      <div className="chorus-reasoning-body">
        <Markdown {...markdownProps} text={reasoning} codeTheme={codeTheme} headless={headless} streaming={streaming} sanitizer={markdownSanitizer ?? markdownProps?.sanitizer} />
      </div>
    </details>
  );
}

function MessageBubbleLayout<TMeta = Record<string, unknown>>({ message, codeTheme, headless, streaming = false, markdownProps, markdownSanitizer, before, headerSlot, footerSlot, after, children }: {
  message: Message<TMeta>;
  codeTheme: 'dark' | 'light';
  headless?: boolean;
  streaming?: boolean;
  markdownProps?: MessageMarkdownProps;
  markdownSanitizer?: MarkdownSanitizer;
  children?: React.ReactNode;
} & MessageBubbleSlots) {
  const hasAttachments = Boolean(message.attachments?.length);
  const hasBubbleText = message.text.trim().length > 0;
  const shouldRenderBubble = hasBubbleText || hasAttachments;

  return (
    <>
      {before}
      <div className="chorus-msg-content">
        {headerSlot}
        <MessageReasoning reasoning={message.reasoning} codeTheme={codeTheme} headless={headless} streaming={streaming} markdownProps={markdownProps} markdownSanitizer={markdownSanitizer} />
        {shouldRenderBubble && (
          <div className="chorus-bubble">
            <MessageAttachments attachments={message.attachments} />
            {hasBubbleText && <Markdown {...markdownProps} text={message.text} codeTheme={codeTheme} headless={headless} streaming={streaming} sanitizer={markdownSanitizer ?? markdownProps?.sanitizer} />}
          </div>
        )}
        {footerSlot}
        {children}
      </div>
      {after}
    </>
  );
}

export function MessageBubble<TMeta = Record<string, unknown>>({ message, className, style, codeTheme = 'dark', headless, streaming = false, markdownProps, markdownSanitizer, before, headerSlot, footerSlot, after }: MessageBubbleProps<TMeta>) {
  const renderState = React.useContext(MessageRenderStateContext);
  if (renderState?.messageId === message.id && renderState.isEditing) return null;

  const cls = ['chorus-msg', `chorus-${message.role}`, className].filter(Boolean).join(' ');
  return (
    <div className={cls} style={style} data-chorus-message-id={message.id}>
      <MessageSpeakerLabel role={message.role} />
      <MessageBubbleLayout
        message={message}
        codeTheme={codeTheme}
        headless={headless ?? false}
        streaming={streaming}
        markdownProps={markdownProps}
        markdownSanitizer={markdownSanitizer}
        before={before}
        headerSlot={headerSlot}
        footerSlot={footerSlot}
        after={after}
      />
    </div>
  );
}

export interface InlineMessageEditorProps {
  initialText: string;
  onSubmit: (newText: string) => void;
  onCancel: () => void;
}

export function InlineMessageEditor({ initialText, onSubmit, onCancel }: InlineMessageEditorProps) {
  const [editText, setEditText] = React.useState(initialText);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    el.focus();
    el.selectionStart = el.value.length;
  }, []);

  const submitEdit = () => {
    const trimmed = editText.trim();
    if (trimmed) onSubmit(trimmed);
    else onCancel();
  };

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
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="chorus-edit-actions">
        <button type="button" className="chorus-action-btn" onClick={submitEdit} title="Save" aria-label="Save"><Check size={14} /></button>
        <button type="button" className="chorus-action-btn" onClick={onCancel} title="Cancel" aria-label="Cancel"><X size={14} /></button>
      </div>
    </div>
  );
}

export interface MessageRowProps<TMeta = Record<string, unknown>> extends MessageBubbleSlots {
  m: Message<TMeta>;
  codeTheme: 'dark' | 'light';
  headless?: boolean;
  onEdit?: (id: string, newText: string) => void;
  onRegenerate?: (id: string) => void;
  onDelete?: (id: string) => void;
  onCopy?: (message: Message<TMeta>) => void;
  onFeedback?: (message: Message<TMeta>, feedback: MessageFeedback) => void;
  streaming?: boolean;
  markdownProps?: MessageMarkdownProps;
  markdownSanitizer?: MarkdownSanitizer;
}

function actionButtonClass(active?: boolean) {
  return ['chorus-action-btn', active && 'chorus-action-btn--active'].filter(Boolean).join(' ');
}

function MessageActions({ actions, onEditRequested }: { actions: MessageRenderActions; onEditRequested: () => void }) {
  const [selectedFeedback, setSelectedFeedback] = React.useState<MessageFeedback | null>(null);
  const hasActions = actions.canEdit || actions.canRegenerate || actions.canDelete || Boolean(actions.copy) || Boolean(actions.feedback);

  if (!hasActions) return null;

  const handleFeedback = (variant: MessageFeedback) => {
    setSelectedFeedback(variant);
    actions.feedback?.(variant);
  };

  return (
    <div className="chorus-actions">
      {actions.canEdit && actions.edit && (
        <button type="button" className="chorus-action-btn" onClick={onEditRequested} title="Edit" aria-label="Edit"><Pencil size={13} /></button>
      )}
      {actions.canRegenerate && actions.regenerate && (
        <button type="button" className="chorus-action-btn" onClick={actions.regenerate} title="Regenerate" aria-label="Regenerate"><RefreshCw size={13} /></button>
      )}
      {actions.copy && (
        <button type="button" className="chorus-action-btn" onClick={actions.copy} title="Copy" aria-label="Copy"><Copy size={13} /></button>
      )}
      {actions.feedback && (
        <>
          <button type="button" className={actionButtonClass(selectedFeedback === 'up')} onClick={() => handleFeedback('up')} title="Thumbs up" aria-label="Thumbs up" aria-pressed={selectedFeedback === 'up'}><ThumbsUp size={13} /></button>
          <button type="button" className={actionButtonClass(selectedFeedback === 'down')} onClick={() => handleFeedback('down')} title="Thumbs down" aria-label="Thumbs down" aria-pressed={selectedFeedback === 'down'}><ThumbsDown size={13} /></button>
        </>
      )}
      {actions.canDelete && actions.delete && (
        <button type="button" className="chorus-action-btn" onClick={actions.delete} title="Delete" aria-label="Delete"><Trash2 size={13} /></button>
      )}
    </div>
  );
}

function createCopyAction<TMeta>(message: Message<TMeta>, onCopy?: (message: Message<TMeta>) => void) {
  if (onCopy) return () => onCopy(message);
  if (canWriteTextToClipboard()) return () => writeTextToClipboard(message.text);
  return undefined;
}

export function MessageActionControls<TMeta = Record<string, unknown>>({ message, actions }: { message: Message<TMeta>; actions: MessageRenderActions }) {
  const [editing, setEditing] = useActionEditing(message.id);
  const hasActions = actions.canEdit || actions.canRegenerate || actions.canDelete || Boolean(actions.copy) || Boolean(actions.feedback);

  if (!hasActions) return null;

  if (editing && actions.edit) {
    return (
      <div className={`chorus-msg chorus-${message.role}`} data-chorus-message-id={message.id}>
        <MessageSpeakerLabel role={message.role} />
        <InlineMessageEditor
          initialText={message.text}
          onSubmit={(newText) => {
            actions.edit?.(newText);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className={`chorus-render-actions chorus-${message.role}`}>
      <div className="chorus-msg-content">
        <MessageActions actions={actions} onEditRequested={() => setEditing(true)} />
      </div>
    </div>
  );
}

export function MessageRow<TMeta = Record<string, unknown>>({ m, codeTheme, headless, onEdit, onRegenerate, onDelete, onCopy, onFeedback, streaming = false, markdownProps, markdownSanitizer, before, headerSlot, footerSlot, after }: MessageRowProps<TMeta>) {
  const [editing, setEditing] = React.useState(false);
  const copy = createCopyAction(m, onCopy);
  const actions: MessageRenderActions = {
    canEdit: Boolean(m.role === 'user' && onEdit),
    canRegenerate: Boolean(m.role === 'assistant' && onRegenerate),
    canDelete: Boolean(onDelete),
    edit: m.role === 'user' && onEdit ? (newText) => onEdit(m.id, newText) : undefined,
    regenerate: m.role === 'assistant' && onRegenerate ? () => onRegenerate(m.id) : undefined,
    delete: onDelete ? () => onDelete(m.id) : undefined,
    copy,
    feedback: onFeedback ? (variant) => onFeedback(m, variant) : undefined,
    defaultRender: () => null,
  };

  return (
    <div className={`chorus-msg chorus-${m.role}`} data-chorus-message-id={m.id}>
      <MessageSpeakerLabel role={m.role} />
      {editing && actions.edit ? (
        <InlineMessageEditor
          initialText={m.text}
          onSubmit={(newText) => {
            actions.edit?.(newText);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <MessageBubbleLayout
          message={m}
          codeTheme={codeTheme}
          headless={headless}
          streaming={streaming}
          markdownProps={markdownProps}
          markdownSanitizer={markdownSanitizer}
          before={before}
          headerSlot={headerSlot}
          footerSlot={footerSlot}
          after={after}
        >
          <MessageActions actions={actions} onEditRequested={() => setEditing(true)} />
        </MessageBubbleLayout>
      )}
    </div>
  );
}
