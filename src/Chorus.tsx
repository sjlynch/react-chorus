import React from 'react';
import './Chorus.css';
import { ChatWindow, type GetMessageFeedback, type MessageFeedback, type MessageMarkdownProps, type RenderErrorContext, type RenderMessageContext } from './components/ChatWindow';
import { ChatInput } from './components/ChatInput';
import { styleVarsFromPalette, type Palette } from './components/ChorusTheme';
import type { Attachment, AttachmentError, ConnectorName, Message, Role, StorageAdapter, UploadAttachment } from './types';
import type { Transport } from './hooks/useChorusStream';
import { useChorusPersistence, type DeserializeMessages, type SerializeMessages } from './hooks/useChorusPersistence';
import { useChorusMessages, type ChorusMessagesChangeContext } from './hooks/useChorusMessages';
import { useAssistantSession } from './hooks/useAssistantSession';
import type { ChorusAbortContext, ChorusAbortReason, ChorusAbortSource, ChorusFinishContext, ChorusOnAbort, ChorusOnFinish, ChorusOnSend, ChorusOnStreamDone, ChorusOnToolCall, ChorusOnToolDelta, ChorusSendHelpers, ChorusSendPath, ChorusShouldContinueToolLoop, ChorusStreamDoneContext, ChorusToolCallContext, ChorusToolDeltaContext, ChorusToolLoopContext, ChorusToolRegistry } from './hooks/useAssistantSession';
import type { Connector } from './connectors/connectors';
import type { MarkdownSanitizer } from './components/Markdown';
import { isChorusDevMode } from './utils/devMode';

export type { Transport };
export type { Connector };
export type { ChorusAbortContext, ChorusAbortReason, ChorusAbortSource, ChorusFinishContext, ChorusMessagesChangeContext, ChorusOnAbort, ChorusOnFinish, ChorusOnSend, ChorusOnStreamDone, ChorusOnToolCall, ChorusOnToolDelta, ChorusSendHelpers, ChorusSendPath, ChorusShouldContinueToolLoop, ChorusStreamDoneContext, ChorusToolCallContext, ChorusToolDeltaContext, ChorusToolLoopContext, ChorusToolRegistry };

const DEFAULT_MIN_ASSISTANT_DELAY_MS = 300;
const DEFAULT_PERSISTENCE_WRITE_DEBOUNCE_MS = 80;
const DEFAULT_CHORUS_HIDDEN_ROLES: Role[] = ['system'];

export interface ChorusRef<TMeta = Record<string, unknown>> {
  send(text: string, attachments?: Attachment[]): void;
  stop(): void;
  clear(): void;
  focus(): void;
  getMessages(): Message<TMeta>[];
  scrollToMessage(id: string): boolean;
}

export interface ChorusProps<TMeta = Record<string, unknown>> extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'onError' | 'onCopy' | 'onAbort'> {
  accept?: string;
  /** Accessible/button label for the built-in clear action. */
  clearLabel?: string;
  codeBlockTheme?: 'dark' | 'light';
  connector?: Connector | ConnectorName;
  /** Opt in to an automatic tool-execution → model-continuation loop on the transport path. */
  autoContinueTools?: boolean;
  /** Maximum automatic tool iterations when autoContinueTools is enabled. Defaults to 4. */
  maxToolIterations?: number;
  /** Optional gate for each automatic tool continuation. Return false to stop before the next model request. */
  shouldContinueToolLoop?: ChorusShouldContinueToolLoop<TMeta>;
  /** Disable composer input, attachment ingestion, prompt fills, and write actions. Stop remains available while sending. */
  disabled?: boolean;
  /** Optional explanation used by the composer placeholder/accessible description while disabled or read-only. */
  disabledReason?: string;
  /** Override built-in JSON persistence deserialization/revival. */
  deserializeMessages?: DeserializeMessages<TMeta>;
  emptyState?: React.ReactNode;
  errorMessage?: string;
  headless?: boolean;
  hiddenRoles?: Role[];
  /** Return a persisted feedback selection for a message. If omitted or undefined, message.metadata.feedback seeds built-in thumbs when it is 'up' or 'down'. */
  getMessageFeedback?: GetMessageFeedback<TMeta>;
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
  /** Built-in controls call this only when the chosen variant differs from the current selection; clicks do not toggle feedback off. */
  onFeedback?: (message: Message<TMeta>, feedback: MessageFeedback) => void;
  /** Called when an active assistant generation is cancelled by Stop, clear, or supersession. */
  onAbort?: ChorusOnAbort<TMeta>;
  /** Called exactly once when an assistant message completes normally. */
  onFinish?: ChorusOnFinish<TMeta>;
  /** Observes transcript changes in controlled, uncontrolled, and persistence-backed modes without making Chorus controlled. */
  onMessagesChange?: (messages: Message<TMeta>[], context: ChorusMessagesChangeContext) => void;
  /** Called when a transport stream completes normally, including tool-only turns. */
  onStreamDone?: ChorusOnStreamDone<TMeta>;
  /** Called when a completed streamed tool call is ready; return a value to append it as tool output. */
  onToolCall?: ChorusOnToolCall<TMeta>;
  /** Observes every accumulated streamed tool-call delta on the transport path. */
  onToolDelta?: ChorusOnToolDelta<TMeta>;
  /** Registry of executable tool handlers keyed by tool name. Matching handlers run after stream input completes. */
  tools?: ChorusToolRegistry<TMeta>;
  /** Called when Chorus cannot read, deserialize, write, or remove the transcript in persistenceStorage. */
  onPersistenceError?: (error: Error) => void;
  onSend?: ChorusOnSend<TMeta>;
  palette?: Palette;
  persistenceKey?: string;
  persistenceStorage?: StorageAdapter;
  placeholder?: string;
  renderError?: (context: RenderErrorContext) => React.ReactNode;
  renderMessage?: (message: Message<TMeta>, context: RenderMessageContext<TMeta>) => React.ReactNode;
  /** Prevent compose/edit/regenerate/delete/retry/clear while leaving read-only actions like copy and scroll available. */
  readOnly?: boolean;
  /** When clearing, restore initialMessages/messages instead of clearing to []. Defaults to false. */
  resetToInitialMessages?: boolean;
  sending?: boolean;
  /** Override built-in JSON persistence serialization. */
  serializeMessages?: SerializeMessages<TMeta>;
  /** Show a built-in button that clears/resets the conversation. */
  showClearButton?: boolean;
  showJumpToBottomButton?: boolean;
  suggestedPrompts?: string[];
  /** Hidden system prompt. Prepended to transport history; exposed as helpers.systemPrompt on the onSend path. */
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
  autoContinueTools,
  maxToolIterations,
  shouldContinueToolLoop,
  disabled = false,
  disabledReason,
  deserializeMessages,
  emptyState,
  errorMessage,
  headless = false,
  hiddenRoles,
  getMessageFeedback,
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
  onAbort,
  onFinish,
  onMessagesChange,
  onStreamDone,
  onToolCall,
  onToolDelta,
  onPersistenceError,
  onSend,
  palette,
  persistenceKey,
  persistenceStorage,
  placeholder,
  renderError,
  renderMessage,
  readOnly = false,
  resetToInitialMessages = false,
  sending: sendingProp,
  serializeMessages,
  showClearButton = false,
  showJumpToBottomButton,
  style,
  suggestedPrompts,
  systemPrompt,
  tools,
  transport,
  uploadAttachment,
  value,
  ...rest
}: ChorusProps<TMeta>, ref: React.ForwardedRef<ChorusRef<TMeta>>) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLDivElement>(null);
  const [draft, setDraft] = React.useState('');
  const [composerResetKey, setComposerResetKey] = React.useState(0);
  const fallbackErrorMessage = errorMessage ?? 'Something went wrong. Please try again.';

  const builtInPersistenceKey = value === undefined ? persistenceKey ?? '' : '';
  const persisted = useChorusPersistence<TMeta>(builtInPersistenceKey, {
    storage: builtInPersistenceKey ? persistenceStorage : null,
    writeDebounceMs: DEFAULT_PERSISTENCE_WRITE_DEBOUNCE_MS,
    onError: builtInPersistenceKey ? onPersistenceError : undefined,
    serializeMessages,
    deserializeMessages,
  });
  const { msgs, messagesRef, updateMsgs, onChunkRef, seedMessages } = useChorusMessages<TMeta>({
    value,
    messages,
    initialMessages,
    onChange,
    onMessagesChange,
    persistenceKey: builtInPersistenceKey,
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
    onAbort,
    onStreamDone,
    onToolCall,
    onToolDelta,
    tools,
    autoContinueTools,
    maxToolIterations,
    shouldContinueToolLoop,
    flushPersistence: persisted.flush,
    resetToInitialMessages,
    onClear,
  });

  const visualSending = sendingProp ?? session.sending;
  const paletteVars = React.useMemo(() => styleVarsFromPalette(palette), [palette]);
  const canAssistantRespond = Boolean(transport || onSend);
  const resolvedShowJumpToBottomButton = showJumpToBottomButton ?? !headless;
  const persistenceLoading = Boolean(builtInPersistenceKey) && !persisted.loaded;
  const canRenderEmptyAffordance = value !== undefined || !builtInPersistenceKey || persisted.loaded;
  const writesDisabled = disabled || readOnly || persistenceLoading;
  const composerDisabled = disabled || persistenceLoading;
  const resolvedDisabledReason = persistenceLoading ? disabledReason ?? 'Loading saved conversation…' : disabledReason;
  const resetComposer = React.useCallback(() => {
    setDraft('');
    setComposerResetKey(key => key + 1);
  }, []);

  const handleInputSend = React.useCallback((attachments: Attachment[] = []) => {
    if (writesDisabled) return;
    if (session.send(draft, attachments)) setDraft('');
  }, [draft, session, writesDisabled]);

  const handleStop = React.useCallback(() => {
    session.stop('user');
  }, [session]);

  const handleClear = React.useCallback(() => {
    if (writesDisabled) return;
    resetComposer();
    session.clear('user');
  }, [resetComposer, session, writesDisabled]);

  const handleSuggestedPrompt = React.useCallback((prompt: string) => {
    if (writesDisabled) return;
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
  }, [writesDisabled]);

  React.useImperativeHandle(ref, () => ({
    send(text: string, attachments: Attachment[] = []) {
      if (writesDisabled) return;
      if (session.send(text, attachments)) setDraft('');
    },
    stop() {
      session.stop('programmatic');
    },
    clear() {
      if (writesDisabled) return;
      resetComposer();
      session.clear('programmatic');
    },
    focus() {
      inputRef.current?.focus();
    },
    getMessages() {
      return messagesRef.current.slice();
    },
    scrollToMessage(id: string) {
      const root = rootRef.current;
      if (!root) return false;
      const nodes = root.querySelectorAll<HTMLElement>('[data-chorus-message-id]');
      const target = Array.from(nodes).find(node => node.dataset.chorusMessageId === id);
      if (!target) return false;
      target.scrollIntoView({ block: 'nearest' });
      return true;
    },
  }), [messagesRef, resetComposer, session, writesDisabled]);

  return (
    <div
      {...rest}
      ref={rootRef}
      className={["chorus", disabled && "chorus--disabled", readOnly && "chorus--readonly", className].filter(Boolean).join(" ")}
      style={{ ...paletteVars, ...style }}
      aria-disabled={writesDisabled ? true : rest['aria-disabled']}
    >
      <ChatWindow<TMeta>
        messages={msgs}
        typing={canAssistantRespond && visualSending && !session.hasStartedAssistant}
        codeTheme={codeBlockTheme}
        emptyState={canRenderEmptyAffordance ? emptyState : undefined}
        error={session.streamError}
        headless={headless}
        hiddenRoles={hiddenRoles ?? DEFAULT_CHORUS_HIDDEN_ROLES}
        markdownProps={markdownProps}
        markdownSanitizer={markdownSanitizer}
        maxRenderedMessages={maxRenderedMessages}
        getMessageFeedback={getMessageFeedback}
        onCopy={onCopy}
        onDelete={writesDisabled ? undefined : session.handleDelete}
        onDismissError={session.dismissError}
        onEdit={!writesDisabled && canAssistantRespond ? session.handleEdit : undefined}
        onFeedback={writesDisabled ? undefined : onFeedback}
        onRegenerate={!writesDisabled && canAssistantRespond ? session.handleRegenerate : undefined}
        onRetry={writesDisabled ? undefined : session.retry}
        onSuggestedPrompt={writesDisabled ? undefined : handleSuggestedPrompt}
        rawError={session.streamRawError}
        renderError={renderError}
        renderMessage={renderMessage}
        showJumpToBottomButton={resolvedShowJumpToBottomButton}
        streamingMessageId={session.streamingMessageId}
        suggestedPrompts={canRenderEmptyAffordance ? suggestedPrompts : undefined}
        suggestedPromptsDisabled={writesDisabled}
        suggestedPromptsDisabledReason={resolvedDisabledReason}
      />
      {showClearButton && (
        <div className="chorus-clear-row">
          <button type="button" className="chorus-clear-btn" onClick={handleClear} disabled={writesDisabled || (!session.sending && msgs.length === 0)}>
            {clearLabel}
          </button>
        </div>
      )}
      <ChatInput
        ref={inputRef}
        value={draft}
        onChange={setDraft}
        onSend={handleInputSend}
        onStop={handleStop}
        sending={visualSending}
        disabled={composerDisabled}
        readOnly={readOnly}
        disabledReason={resolvedDisabledReason}
        resetKey={composerResetKey}
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
  props: ChorusProps<TMeta> & React.RefAttributes<ChorusRef<TMeta>>,
) => React.ReactElement | null;

(Chorus as React.NamedExoticComponent).displayName = 'Chorus';

export default Chorus;
