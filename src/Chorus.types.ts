import type React from 'react';
import type { GetMessageFeedback, MessageCopyResult, MessageFeedback, MessageMarkdownProps, RenderErrorContext, RenderMessageContext } from './components/ChatWindow';
import type { RenderAttachmentErrorContext } from './components/ChatInput';
import type { Palette } from './components/ChorusTheme';
import type { Attachment, AttachmentError, ConnectorName, Message, Role, StorageAdapter, UploadAttachment } from './types';
import type { Transport } from './hooks/useChorusStream';
import type { ChorusLabels } from './labels/types';
import type { FetchTransportInit } from './hooks/assistant-session/transport';
import type { DeserializeMessages, SerializeMessages } from './hooks/useChorusPersistence';
import type { ChorusMessagesChangeContext } from './hooks/useChorusMessages';
import type { ChorusAbortContext, ChorusAbortReason, ChorusAbortSource, ChorusClearConversationContext, ChorusConfirmClearConversation, ChorusConfirmDeleteMessage, ChorusDeleteMessageContext, ChorusFinishContext, ChorusOnAbort, ChorusOnFinish, ChorusOnSend, ChorusOnStreamDone, ChorusOnToolCall, ChorusOnToolDelta, ChorusSendHelpers, ChorusSendPath, ChorusShouldContinueToolLoop, ChorusStreamDoneContext, ChorusStreamDoneReason, ChorusToolCallContext, ChorusToolDeltaContext, ChorusToolLoopContext, ChorusToolRegistry } from './hooks/useAssistantSession';
import type { Connector, ConnectorWarning } from './connectors/connectors';
import type { MarkdownSanitizer } from './components/Markdown';

export type { Transport };
export type { FetchTransportInit };
export type { Connector, ConnectorWarning };
export type { RenderAttachmentErrorContext };
export type { ChorusAbortContext, ChorusAbortReason, ChorusAbortSource, ChorusClearConversationContext, ChorusConfirmClearConversation, ChorusConfirmDeleteMessage, ChorusDeleteMessageContext, ChorusFinishContext, ChorusMessagesChangeContext, ChorusOnAbort, ChorusOnFinish, ChorusOnSend, ChorusOnStreamDone, ChorusOnToolCall, ChorusOnToolDelta, ChorusSendHelpers, ChorusSendPath, ChorusShouldContinueToolLoop, ChorusStreamDoneContext, ChorusStreamDoneReason, ChorusToolCallContext, ChorusToolDeltaContext, ChorusToolLoopContext, ChorusToolRegistry };

export const DEFAULT_MIN_ASSISTANT_DELAY_MS = 300;
export const DEFAULT_PERSISTENCE_WRITE_DEBOUNCE_MS = 80;
export const DEFAULT_CHORUS_HIDDEN_ROLES: Role[] = ['system'];

export interface ChorusRef<TMeta = Record<string, unknown>> {
  /**
   * Programmatically submit a user message. Returns `true` when Chorus accepted
   * the send and started a turn, and `false` when it was rejected. A `false`
   * result means nothing was appended to the transcript and no transport/onSend
   * call was made — rejection cases are:
   * - `disabled` / `readOnly`, or an async built-in persistence load is pending (writes are gated);
   * - controlled mode (`value` provided) with no `onChange` prop, so the new message could not be reflected;
   * - a send/tool turn is already in flight;
   * - the text is empty and no attachments were supplied;
   * - neither `transport` nor `onSend` is configured.
   */
  send(text: string, attachments?: Attachment[]): boolean;
  stop(): void;
  /**
   * Programmatically clear the transcript. Returns `true` when the clear path
   * was kicked off and `false` when it was rejected. Rejection cases are:
   * - `disabled` / `readOnly`, or an async built-in persistence load is pending;
   * - a previous `confirmClearConversation` promise is still pending;
   * - controlled mode (`value` provided) with no `onChange` prop, so the reset could not be reflected.
   *
   * Note: when `confirmClearConversation` is configured, `true` means the
   * confirmation flow was started — the actual reset still depends on the
   * callback resolving to anything other than `false`.
   */
  clear(): boolean;
  focus(): void;
  getMessages(): Message<TMeta>[];
  scrollToMessage(id: string): boolean;
}

export interface ChorusProps<TMeta = Record<string, unknown>> extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'onError' | 'onCopy' | 'onAbort'> {
  accept?: string;
  /**
   * Always render the per-message action buttons (edit/regenerate/copy/feedback/delete)
   * instead of revealing them on hover. Coarse pointers and `(hover: none)` media
   * already get this behavior automatically; set this to opt in on pointer devices too.
   */
  alwaysShowMessageActions?: boolean;
  /** Accessible/button label for the built-in clear action. */
  clearLabel?: string;
  codeBlockTheme?: 'dark' | 'light';
  connector?: Connector | ConnectorName;
  /** Optional gate for built-in message deletes. Return or resolve false to cancel. */
  confirmDeleteMessage?: ChorusConfirmDeleteMessage<TMeta>;
  /** Optional gate for the built-in clear/reset action. Return or resolve false to cancel before persistence is touched. While an async confirmation is pending, the clear button is disabled and duplicate clears are ignored. */
  confirmClearConversation?: ChorusConfirmClearConversation<TMeta>;
  /** Opt in to an automatic tool-execution → model-continuation loop on the transport path. */
  autoContinueTools?: boolean;
  /** Maximum automatic tool iterations when autoContinueTools is enabled. Defaults to 4; pass Infinity to explicitly disable the safety cap. */
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
  /**
   * Replace the built-in attachment error region rendered under the composer.
   * Pass `null` to suppress the default UI entirely (e.g. when you fully handle
   * errors via `onAttachmentError`).
   */
  renderAttachmentError?: ((context: RenderAttachmentErrorContext) => React.ReactNode) | null;
  onChange?: (messages: Message<TMeta>[]) => void;
  onChunk?: (chunk: string, messageId: string) => void;
  /** Called after the clear/reset action chooses the next message list. */
  onClear?: (messages: Message<TMeta>[]) => void;
  /**
   * Overrides the built-in per-message Copy action. Return false (or Promise<false>)
   * to show the Copy failed indicator; return void to keep historical assume-success behavior.
   */
  onCopy?: (message: Message<TMeta>) => MessageCopyResult;
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
  /**
   * Called for non-fatal connector warnings on the `transport` path — e.g. a
   * `truncated` warning when the model hit its max-token limit, or safety-rating
   * notices. The stream still completes normally (`onFinish`/`onStreamDone` fire as
   * usual); use this to tell the user the response may be cut off or partially
   * blocked. A throwing handler is warned in development and otherwise ignored.
   */
  onStreamWarning?: (warning: ConnectorWarning) => void;
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
  /** Simple path: URL string, `{ url, headers, credentials, ... }` config object, or a custom `Transport` function. */
  transport?: string | FetchTransportInit<TMeta> | Transport<TMeta>;
  uploadAttachment?: UploadAttachment;
  value?: Message<TMeta>[];
  /**
   * Localized labels for every built-in UI string (composer placeholder/aria-labels,
   * transcript aria-label/typing/retry/jump/empty title, message actions, speakers,
   * tool call sections, reasoning summary, code-copy button, and the clear button).
   * Defaults preserve the current English strings; the existing `placeholder`,
   * `disabledReason`, and `clearLabel` props take precedence when provided.
   */
  labels?: ChorusLabels;
}
