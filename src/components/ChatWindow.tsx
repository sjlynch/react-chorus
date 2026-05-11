import React from 'react';
import type { Message, Role } from '../types';
import { Markdown } from './Markdown';
import { Pencil, RefreshCw, Trash2, Check, X } from 'lucide-react';
import { ToolCallBlock } from './ToolCallBlock';

const DEFAULT_HIDDEN_ROLES: Role[] = ['system', 'tool'];
const NO_HIDDEN_ROLES: Role[] = [];
const SCROLL_BOTTOM_THRESHOLD_PX = 48;
let didWarnShowSystemMessages = false;

function isNearBottom(el: HTMLElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_BOTTOM_THRESHOLD_PX;
}

export interface ChatWindowProps {
  messages: Message[];
  typing?: boolean;
  codeTheme?: 'dark' | 'light';
  headless?: boolean;
  renderMessage?: (message: Message) => React.ReactNode;
  /** Message roles hidden from the transcript. Defaults to ['system', 'tool']; pass ['system'] to show tool calls while hiding system prompts, or [] to show every role. */
  hiddenRoles?: Role[];
  /** @deprecated Use hiddenRoles instead. When hiddenRoles is omitted, true is equivalent to hiddenRoles={[]} and false keeps the default ['system', 'tool']. */
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

export function ChatWindow({ messages, typing, codeTheme = 'dark', headless = false, renderMessage, hiddenRoles, showSystemMessages, onEdit, onRegenerate, onDelete, error, onRetry }: ChatWindowProps) {
  React.useEffect(() => {
    if (showSystemMessages === undefined || didWarnShowSystemMessages) return;
    console.warn('[Chorus] `showSystemMessages` is deprecated. Use `hiddenRoles` instead (for example hiddenRoles={[\'system\']} to show tool messages while hiding system prompts).');
    didWarnShowSystemMessages = true;
  }, [showSystemMessages]);

  const effectiveHiddenRoles = hiddenRoles ?? (showSystemMessages ? NO_HIDDEN_ROLES : DEFAULT_HIDDEN_ROLES);
  const hiddenRoleSet = React.useMemo(() => new Set<Role>(effectiveHiddenRoles), [effectiveHiddenRoles]);
  const visible = React.useMemo(() => messages.filter(m => !hiddenRoleSet.has(m.role)), [messages, hiddenRoleSet]);

  const windowRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = React.useRef(true);
  const scrollRafRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const el = windowRef.current;
    if (!el) return;

    const onScroll = () => { shouldAutoScrollRef.current = isNearBottom(el); };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  React.useEffect(() => {
    if (!shouldAutoScrollRef.current) return;

    const scrollToBottom = () => {
      scrollRafRef.current = null;
      if (!shouldAutoScrollRef.current) return;
      if (typeof bottomRef.current?.scrollIntoView === 'function') {
        bottomRef.current.scrollIntoView({ block: 'end' });
      } else if (windowRef.current) {
        windowRef.current.scrollTop = windowRef.current.scrollHeight;
      }
      shouldAutoScrollRef.current = true;
    };

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      if (scrollRafRef.current != null) return;
      scrollRafRef.current = window.requestAnimationFrame(scrollToBottom);
      return;
    }

    scrollToBottom();
  }, [visible, typing, error]);

  React.useEffect(() => () => {
    if (scrollRafRef.current != null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(scrollRafRef.current);
    }
  }, []);

  return (
    <div className="chorus-window" ref={windowRef}>
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
      <div ref={bottomRef} className="chorus-scroll-sentinel" aria-hidden="true" />
    </div>
  );
}
