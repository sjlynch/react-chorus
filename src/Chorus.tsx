import React from 'react';
import './Chorus.css';
import { ChatWindow, type MessageFeedback, type MessageMarkdownProps, type RenderErrorContext, type RenderMessageContext } from './components/ChatWindow';
import { ChatInput } from './components/ChatInput';
import { styleVarsFromPalette, type Palette } from './components/ChorusTheme';
import type { Attachment, AttachmentError, ConnectorName, Message, Role, StorageAdapter, UploadAttachment } from './types';
import type { Transport } from './hooks/useChorusStream';
import { useChorusPersistence } from './hooks/useChorusPersistence';
import { useChorusMessages } from './hooks/useChorusMessages';
import { useAssistantSession } from './hooks/useAssistantSession';
import type { ChorusFinishContext, ChorusOnFinish, ChorusOnSend, ChorusSendHelpers } from './hooks/useAssistantSession';
import type { Connector } from './connectors/connectors';
import type { MarkdownSanitizer } from './components/Markdown';
import { isChorusDevMode } from './utils/devMode';

export type { Transport };
export type { Connector };
export type { ChorusFinishContext, ChorusOnFinish, ChorusOnSend, ChorusSendHelpers };

const DEFAULT_MIN_ASSISTANT_DELAY_MS = 300;
const DEFAULT_PERSISTENCE_WRITE_DEBOUNCE_MS = 80;

export interface ChorusRef {
  send(text: string, attachments?: Attachment[]): void;
  stop(): void;
  clear(): void;
  focus(): void;
  scrollToMessage(id: string): void;
}

export interface ChorusProps<TMeta = Record<string, unknown>> extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'onError' | 'onCopy'> {
  accept?: string;
  /** Accessible/button label for the built-in clear action. */
  clearLabel?: string;
  codeBlockTheme?: 'dark' | 'light';
  connector?: Connector | ConnectorName;
  emptyState?: React.ReactNode;
  errorMessage?: string;
  headless?: boolean;
  hiddenRoles?: Role[];
  /** Initial messages for uncontrolled mode. Useful for welcome messages. */
  initialMessages?: Message<TMeta>[];
  /** Props forwarded to the built-in Markdown renderer for message text. */
  markdownProps?: MessageMarkdownProps;
  /** Convenience alias for markdownProps.sanitizer. Takes precedence when both are provided. */
  markdownSanitizer?: MarkdownSanitizer;
  maxAttachmentBytes?: number;
  maxAttachments?: number;
  /** Render only the latest N visible messages. Typing and error rows still render outside this message window. */
  maxRenderedMessages?: number;
  messages?: Message<TMeta>[];
  minAssistantDelayMs?: number;
  onAttachmentError?: (error: AttachmentError) => void;
  onChange?: (messages: Message<TMeta>[]) => void;
  onChunk?: (chunk: string, messageId: string) => void;
  /** Called after the clear/reset action chooses the next message list. */
  onClear?: (messages: Message<TMeta>[]) => void;
  onCopy?: (message: Message<TMeta>) => void;
  onError?: (error: Error) => void;
  onFeedback?: (message: Message<TMeta>, feedback: MessageFeedback) => void;
  /** Called exactly once when an assistant message completes normally. */
  onFinish?: ChorusOnFinish<TMeta>;
  /** Called when Chorus cannot write the transcript to persistenceStorage. */
  onPersistenceError?: (error: Error) => void;
  onSend?: ChorusOnSend<TMeta>;
  palette?: Palette;
  persistenceKey?: string;
  persistenceStorage?: StorageAdapter;
  placeholder?: string;
  renderError?: (context: RenderErrorContext) => React.ReactNode;
  renderMessage?: (message: Message<TMeta>, context: RenderMessageContext<TMeta>) => React.ReactNode;
  /** When clearing, restore initialMessages/messages instead of clearing to []. Defaults to false. */
  resetToInitialMessages?: boolean;
  sending?: boolean;
  /** Show a built-in button that clears/resets the conversation. */
  showClearButton?: boolean;
  showJumpToBottomButton?: boolean;
  suggestedPrompts?: string[];
  /** Hidden system prompt prepended to transport request history. */
  systemPrompt?: string;
  /** Simple path: URL or Transport function. */
  transport?: string | Transport<TMeta>;
  uploadAttachment?: UploadAttachment;
  value?: Message<TMeta>[];
}

function ChorusInner<TMeta = Record<string, unknown>>({
  accept,
  className,
  clearLabel = 'Clear conversation',
  codeBlockTheme = 'dark',
  connector,
  emptyState,
  errorMessage,
  headless = false,
  hiddenRoles,
  initialMessages,
  markdownProps,
  markdownSanitizer,
  maxAttachmentBytes,
  maxAttachments,
  maxRenderedMessages,
  messages,
  minAssistantDelayMs = DEFAULT_MIN_ASSISTANT_DELAY_MS,
  onAttachmentError,
  onChange,
  onChunk,
  onClear,
  onCopy,
  onError,
  onFeedback,
  onFinish,
  onPersistenceError,
  onSend,
  palette,
  persistenceKey,
  persistenceStorage,
  placeholder,
  renderError,
  renderMessage,
  resetToInitialMessages = false,
  sending: sendingProp,
  showClearButton = false,
  showJumpToBottomButton,
  style,
  suggestedPrompts,
  systemPrompt,
  transport,
  uploadAttachment,
  value,
  ...rest
}: ChorusProps<TMeta>, ref: React.ForwardedRef<ChorusRef>) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLDivElement>(null);
  const [draft, setDraft] = React.useState('');
  const fallbackErrorMessage = errorMessage ?? 'Something went wrong. Please try again.';

  const persisted = useChorusPersistence<TMeta>(persistenceKey ?? '', {
    storage: persistenceStorage,
    writeDebounceMs: DEFAULT_PERSISTENCE_WRITE_DEBOUNCE_MS,
    onError: onPersistenceError,
  });
  const { msgs, updateMsgs, onChunkRef, seedMessages } = useChorusMessages<TMeta>({
    value,
    messages,
    initialMessages,
    onChange,
    persistenceKey,
    persistedMessages: persisted.value,
    persistenceLoaded: persisted.loaded,
    hasPersistedValue: persisted.hasStoredValue,
    canPersist: persisted.canPersist,
    onPersistedChange: persisted.onChange,
    onChunk,
  });

  React.useEffect(() => {
    if (!isChorusDevMode()) return;

    if (messages !== undefined && onChange) {
      console.warn('[Chorus] `messages` is initial-only and does not make <Chorus> controlled. Use `value` + `onChange` for controlled mode, or rename `messages` to `initialMessages` when you only want to seed uncontrolled state.');
    }

    if (messages !== undefined && initialMessages !== undefined) {
      console.warn('[Chorus] Both `messages` and `initialMessages` were provided. `messages` wins as the initial seed; remove one or the other to avoid ambiguity.');
    }

    if (value !== undefined && persistenceKey) {
      console.warn('[Chorus] Both `value` and `persistenceKey` were provided. `value` makes the message list controlled, so built-in persistence is ignored and message changes are not saved automatically. Remove `persistenceKey` or manage persistence in your controlled state.');
    }

    if (value !== undefined && !onChange) {
      console.warn('[Chorus] `value` makes Chorus controlled, but no `onChange` prop was provided. `onChange` is required for the built-in send/edit/delete/clear UI to update controlled messages.');
    }

    if (connector !== undefined && transport === undefined && onSend) {
      console.warn('[Chorus] `connector` only applies to the `transport` send path. With `onSend` you parse the response yourself — pass `connector` into the `useChorusStream` call inside your `onSend` if you need it.');
    }

    if (sendingProp !== undefined && transport) {
      console.warn('[Chorus] `sending` was provided alongside `transport`. Chorus owns the transport send state; `sending` is primarily for fully custom `onSend`/`useChorusStream` integrations.');
    }
  }, [messages, initialMessages, onChange, value, persistenceKey, connector, transport, onSend, sendingProp]);

  const session = useAssistantSession<TMeta>({
    messages: msgs,
    updateMessages: updateMsgs,
    seedMessages,
    transport,
    systemPrompt,
    connector,
    onSend,
    minAssistantDelayMs,
    fallbackErrorMessage,
    onError,
    onChunkRef,
    onFinish,
    flushPersistence: persisted.flush,
    resetToInitialMessages,
    onClear,
  });

  const visualSending = sendingProp ?? session.sending;
  const paletteVars = React.useMemo(() => styleVarsFromPalette(palette), [palette]);
  const canAssistantRespond = Boolean(transport || onSend);
  const resolvedShowJumpToBottomButton = showJumpToBottomButton ?? !headless;
  const canRenderEmptyAffordance = value !== undefined || !persistenceKey || persisted.loaded;

  const handleInputSend = React.useCallback((attachments: Attachment[] = []) => {
    if (session.send(draft, attachments)) setDraft('');
  }, [draft, session]);

  const handleClear = React.useCallback(() => {
    setDraft('');
    session.clear();
  }, [session]);

  const handleSuggestedPrompt = React.useCallback((prompt: string) => {
    setDraft(prompt);

    const focusComposer = () => {
      const el = rootRef.current?.querySelector<HTMLTextAreaElement>('.chorus-input textarea');
      if (!el) return;
      el.focus();
      el.selectionStart = el.value.length;
      el.selectionEnd = el.value.length;
    };

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(focusComposer);
    } else {
      focusComposer();
    }
  }, []);

  React.useImperativeHandle(ref, () => ({
    send(text: string, attachments: Attachment[] = []) {
      if (session.send(text, attachments)) setDraft('');
    },
    stop() {
      session.stop();
    },
    clear() {
      setDraft('');
      session.clear();
    },
    focus() {
      inputRef.current?.focus();
    },
    scrollToMessage(id: string) {
      const root = rootRef.current;
      if (!root) return;
      const nodes = root.querySelectorAll<HTMLElement>('[data-chorus-message-id]');
      const target = Array.from(nodes).find(node => node.dataset.chorusMessageId === id);
      target?.scrollIntoView({ block: 'nearest' });
    },
  }), [session]);

  return (
    <div {...rest} ref={rootRef} className={["chorus", className].filter(Boolean).join(" ")} style={{ ...paletteVars, ...style }}>
      <ChatWindow<TMeta>
        messages={msgs}
        typing={canAssistantRespond && visualSending && !session.hasStartedAssistant}
        codeTheme={codeBlockTheme}
        emptyState={canRenderEmptyAffordance ? emptyState : undefined}
        error={session.streamError}
        headless={headless}
        hiddenRoles={hiddenRoles}
        markdownProps={markdownProps}
        markdownSanitizer={markdownSanitizer}
        maxRenderedMessages={maxRenderedMessages}
        onCopy={onCopy}
        onDelete={session.handleDelete}
        onDismissError={session.dismissError}
        onEdit={canAssistantRespond ? session.handleEdit : undefined}
        onFeedback={onFeedback}
        onRegenerate={canAssistantRespond ? session.handleRegenerate : undefined}
        onRetry={session.retry}
        onSuggestedPrompt={handleSuggestedPrompt}
        rawError={session.streamRawError}
        renderError={renderError}
        renderMessage={renderMessage}
        showJumpToBottomButton={resolvedShowJumpToBottomButton}
        streamingMessageId={session.streamingMessageId}
        suggestedPrompts={canRenderEmptyAffordance ? suggestedPrompts : undefined}
      />
      {showClearButton && (
        <div className="chorus-clear-row">
          <button type="button" className="chorus-clear-btn" onClick={handleClear} disabled={!session.sending && msgs.length === 0}>
            {clearLabel}
          </button>
        </div>
      )}
      <ChatInput
        ref={inputRef}
        value={draft}
        onChange={setDraft}
        onSend={handleInputSend}
        onStop={session.stop}
        sending={visualSending}
        placeholder={placeholder}
        accept={accept}
        maxAttachmentBytes={maxAttachmentBytes}
        maxAttachments={maxAttachments}
        onAttachmentError={onAttachmentError}
        uploadAttachment={uploadAttachment}
      />
    </div>
  );
}

export const Chorus = React.forwardRef(ChorusInner) as <TMeta = Record<string, unknown>>(
  props: ChorusProps<TMeta> & React.RefAttributes<ChorusRef>,
) => React.ReactElement | null;

(Chorus as React.NamedExoticComponent).displayName = 'Chorus';

export default Chorus;
