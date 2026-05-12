import React from 'react';
import type { Message, Role } from '../types';
import { ToolCallBlock } from './ToolCallBlock';
import { MessageRow } from './MessageRow';

export { MessageBubble } from './MessageRow';
export type { MessageBubbleProps } from './MessageRow';

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
  /** Internal optimization hint: render the active assistant message as escaped plain text until it finalizes. */
  streamingMessageId?: string | null;
}

export function ChatWindow({ messages, typing, codeTheme = 'dark', headless = false, renderMessage, hiddenRoles, showSystemMessages, onEdit, onRegenerate, onDelete, error, onRetry, streamingMessageId }: ChatWindowProps) {
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
    <div className="chorus-window" ref={windowRef} role="log" aria-live="polite" aria-label="Chat transcript">
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
          <MessageRow key={m.id} m={m} codeTheme={codeTheme} headless={headless} streaming={m.id === streamingMessageId} onEdit={onEdit} onRegenerate={onRegenerate} onDelete={onDelete} />
        );
      })}

      {typing &&
        <div className="chorus-msg chorus-assistant chorus-typing" role="status" aria-label="Assistant is typing">
          <div className="chorus-bubble" aria-hidden="true"><span className="chorus-dot"></span><span className="chorus-dot"></span><span className="chorus-dot"></span></div>
        </div>
      }
      {error &&
        <div className="chorus-error" role="alert">
          <span className="chorus-error-text">{error}</span>
          {onRetry && <button className="chorus-retry-btn" onClick={onRetry}>Retry</button>}
        </div>
      }
      <div ref={bottomRef} className="chorus-scroll-sentinel" aria-hidden="true" />
    </div>
  );
}
