import type React from 'react';
import type { GetMessageFeedback, MessageCopyResult, MessageFeedback, MessageMarkdownProps, MessageTimestampFormatter, RenderErrorContext, RenderMessageContext } from './components/ChatWindow';
import type { RenderAttachmentErrorContext } from './components/ChatInput';
import type { Palette } from './components/ChorusTheme';
import type { Attachment, AttachmentError, ConnectorName, Message, Role, StorageAdapter, UploadAttachment } from './types';
import type { Transport } from './hooks/useChorusStream';
import type { ChorusLabels } from './labels/types';
import type { FetchTransportInit } from './hooks/assistant-session/transport';
import type { DeserializeMessages, SerializeMessages } from './hooks/useChorusPersistence';
import type { ChorusMessagesChangeContext, ChorusMessagesChangeReason, ChorusMessagesChangeSource } from './hooks/useChorusMessages';
import type { ChorusAbortContext, ChorusAbortReason, ChorusAbortSource, ChorusClearConversationContext, ChorusConfirmClearConversation, ChorusConfirmDeleteMessage, ChorusDeleteMessageContext, ChorusFinishContext, ChorusOnAbort, ChorusOnFinish, ChorusOnSend, ChorusOnStreamDone, ChorusOnToolCall, ChorusOnToolDelta, ChorusSendHelpers, ChorusSendPath, ChorusShouldContinueToolLoop, ChorusStreamDoneContext, ChorusStreamDoneReason, ChorusToolCallContext, ChorusToolDeltaContext, ChorusToolHandler, ChorusToolLoopContext, ChorusToolRegistry } from './hooks/useAssistantSession';
import type { Connector, ConnectorWarning } from './connectors/connectors';
import type { OpenAIConnectorOptions } from './connectors/openai';
import type { MarkdownSanitizer } from './components/Markdown';

export type { Transport };
export type { FetchTransportInit };
export type { Connector, ConnectorWarning };
export type { RenderAttachmentErrorContext };
export type { ChorusAbortContext, ChorusAbortReason, ChorusAbortSource, ChorusClearConversationContext, ChorusConfirmClearConversation, ChorusConfirmDeleteMessage, ChorusDeleteMessageContext, ChorusFinishContext, ChorusMessagesChangeContext, ChorusMessagesChangeReason, ChorusMessagesChangeSource, ChorusOnAbort, ChorusOnFinish, ChorusOnSend, ChorusOnStreamDone, ChorusOnToolCall, ChorusOnToolDelta, ChorusSendHelpers, ChorusSendPath, ChorusShouldContinueToolLoop, ChorusStreamDoneContext, ChorusStreamDoneReason, ChorusToolCallContext, ChorusToolDeltaContext, ChorusToolHandler, ChorusToolLoopContext, ChorusToolRegistry };

export const DEFAULT_MIN_ASSISTANT_DELAY_MS = 300;
export const DEFAULT_PERSISTENCE_WRITE_DEBOUNCE_MS = 80;
export const DEFAULT_CHORUS_HIDDEN_ROLES: Role[] = ['system'];

/**
 * Type of the `connectorOptions` prop. Currently an alias for
 * `OpenAIConnectorOptions` because the `'openai'` connector is the only
 * built-in connector that consumes options today. It is declared as its own
 * named type so the underlying shape can later widen to a union (e.g. once
 * Gemini/Anthropic gain options) without changing the declared identity of
 * `ChorusProps['connectorOptions']` — honoring the "never break `ChorusProps`"
 * invariant.
 */
export type ChorusConnectorOptions = OpenAIConnectorOptions;

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
   *
   * On an accepted send the composer is reset the same way a UI-driven send
   * resets it: the draft is cleared, the textarea collapses to a single line,
   * and any attachment chips the user had staged are discarded.
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
  /**
   * Re-run the last assistant turn after a stream error — the imperative
   * equivalent of the built-in error banner's Retry control. Returns `true`
   * when a retry was started and `false` when it was rejected. Rejection cases
   * are:
   * - there is no current stream error to retry;
   * - `disabled` / `readOnly`, or an async built-in persistence load is pending;
   * - controlled mode (`value` provided) with no `onChange` prop.
   */
  retry(): boolean;
  /**
   * Regenerate a specific assistant message, replaying the conversation from
   * the user turn that preceded it. Returns `true` when regeneration was
   * started and `false` when it was rejected. Rejection cases are:
   * - `messageId` does not match a message, or no user message precedes it;
   * - `disabled` / `readOnly`, or an async built-in persistence load is pending;
   * - controlled mode (`value` provided) with no `onChange` prop.
   */
  regenerate(messageId: string): boolean;
  /**
   * Clear the current stream error state — the imperative equivalent of
   * dismissing the built-in error banner. Returns `true` when an error was
   * cleared and `false` when it was rejected. Rejection cases are:
   * - there is no current stream error to dismiss;
   * - controlled mode (`value` provided) with no `onChange` prop.
   *
   * Unlike the other mutators, this is **not** gated by `disabled` /
   * `readOnly` / a pending persistence load: dismissing an error mutates
   * only transient stream-error state, not the transcript, so it stays
   * available in those modes — matching the built-in banner's dismiss button.
   */
  dismissError(): boolean;
  focus(): void;
  getMessages(): Message<TMeta>[];
  /**
   * Scroll the transcript to a message's row. Returns `true` when a rendered
   * row for `id` was found and scrolled into view, and `false` otherwise.
   *
   * A `false` result covers two distinct cases:
   * - `id` matches no message in the transcript; or
   * - `id` is a valid message (one `getMessages()` returns) whose row is not
   *   currently in the DOM — windowed out by `maxRenderedMessages`, hidden by
   *   `hiddenRoles`, or drawn by a custom `renderMessage` that did not spread
   *   `ctx.messageProps`.
   *
   * To tell the two apart, cross-check `id` against `getMessages()`: a `false`
   * for an id `getMessages()` includes is the valid-but-unrendered case. In
   * development that case also logs a one-time warning. In particular a
   * "jump to message"/citation target older than the `maxRenderedMessages`
   * window cannot be scrolled to until enough older rows render.
   */
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
  /**
   * Options forwarded to the built-in connector resolved from a `connector`
   * string. Currently only the `'openai'` connector consumes options (e.g.
   * `{ thinkTag: { start: '<reasoning>', end: '</reasoning>' } }` for a custom
   * reasoning tag pair). Ignored when `connector` is a custom `Connector`
   * object — build that object with `createOpenAIConnector(options)` instead.
   */
  connectorOptions?: ChorusConnectorOptions;
  /** Optional gate for built-in message deletes. Return or resolve false to cancel. */
  confirmDeleteMessage?: ChorusConfirmDeleteMessage<TMeta>;
  /** Optional gate for the built-in clear/reset action. Return or resolve false to cancel before persistence is touched. While an async confirmation is pending, the clear button is disabled and duplicate clears are ignored. */
  confirmClearConversation?: ChorusConfirmClearConversation<TMeta>;
  /** Opt in to an automatic tool-execution → model-continuation loop on the transport path. */
  autoContinueTools?: boolean;
  /** Maximum automatic tool iterations when autoContinueTools is enabled. Defaults to 4; pass Infinity to explicitly disable the safety cap. */
  maxToolIterations?: number;
  /**
   * Treat a thrown tool handler (or `onToolCall`) error as a normal tool result instead of a
   * terminal turn failure. The error is still recorded on the tool row (`{ error: message }`
   * output plus `metadata.isError`); with `autoContinueTools` enabled the loop then continues,
   * feeding the error tool result back to the model so it can self-recover. Abort errors (Stop)
   * always end the turn regardless. Defaults to `false`.
   */
  continueOnToolError?: boolean;
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
  /**
   * Initial messages for uncontrolled mode. Useful for welcome messages.
   *
   * Frozen-seed contract: the seed (`messages ?? initialMessages`) is captured
   * once at mount and never re-derived. Swapping this array after mount (e.g.
   * rebuilding welcome messages on a locale/theme change) is ignored — the
   * transcript does not re-seed and `resetToInitialMessages` still restores the
   * mount-time value. In development a one-time warning fires when the
   * reference changes. To replace the transcript, use `value` + `onChange`,
   * call `ChorusRef.clear()`, or remount via `key={...}`.
   */
  initialMessages?: Message<TMeta>[];
  /** Props forwarded to the built-in Markdown renderer for message text. */
  markdownProps?: MessageMarkdownProps;
  /** Convenience alias for markdownProps.sanitizer. Takes precedence when both are provided. */
  markdownSanitizer?: MarkdownSanitizer;
  maxAttachmentBytes?: number;
  maxAttachments?: number;
  /** Render only the latest N visible messages. Typing and error rows still render outside this message window. */
  maxRenderedMessages?: number;
  /**
   * Legacy initial-only seed for uncontrolled mode; prefer `initialMessages`.
   * Wins over `initialMessages` when both are set and follows the same
   * frozen-seed contract — captured once at mount, later reference changes are
   * ignored and warned about once in development.
   */
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
  /**
   * Observation hook called once per streamed assistant **text** chunk, on both
   * the `transport` and `onSend` paths. `chunk` is the incremental text delta
   * (not the running transcript); `messageId` is the assistant message it
   * belongs to, so chunks can be correlated to a message.
   *
   * Text content only: reasoning/thinking deltas, tool-call deltas, and
   * provider error frames do NOT trigger `onChunk`. A host mirroring or
   * measuring streamed output through `onChunk` therefore never sees reasoning
   * tokens. Pure observation — it does not affect streaming or rendering.
   */
  onChunk?: (chunk: string, messageId: string) => void;
  /** Called after the clear/reset action chooses the next message list. */
  onClear?: (messages: Message<TMeta>[]) => void;
  /**
   * Overrides the built-in per-message Copy action. Return false (or Promise<false>)
   * to show the Copy failed indicator; return void to keep historical assume-success behavior.
   */
  onCopy?: (message: Message<TMeta>) => MessageCopyResult;
  onError?: (error: Error) => void;
  /** Enables built-in thumbs-up/down controls and reports changes. Receives `null` when the active thumb is clicked again to clear the rating. */
  onFeedback?: (message: Message<TMeta>, feedback: MessageFeedback | null) => void;
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
  /**
   * Called with free-form provider metadata on the `transport` path as connectors emit it —
   * e.g. OpenAI Responses token `usage`, Anthropic `stopReason`/`stopSequence`, Gemini
   * `safetyRatings`/`finishReason`, OpenAI Chat `finishReason`. The stream still completes
   * normally (`onFinish`/`onStreamDone` fire as usual); wire this for usage/cost telemetry or
   * to persist safety ratings. A throwing handler is warned in development and otherwise
   * ignored. Fires once per connector result that carries metadata, so a handler may be
   * called multiple times during a single turn.
   */
  onStreamMetadata?: (metadata: Record<string, unknown>) => void;
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
  /**
   * When clearing, restore the `initialMessages`/`messages` seed instead of
   * clearing to `[]`. Defaults to false.
   *
   * The restored seed is the mount-time value (frozen-seed contract): if a
   * parent swapped `initialMessages`/`messages` after mount, `clear()` still
   * restores the original seed, not the latest array. Remount via `key={...}`
   * to reset the seed.
   */
  resetToInitialMessages?: boolean;
  sending?: boolean;
  /** Override built-in JSON persistence serialization. */
  serializeMessages?: SerializeMessages<TMeta>;
  /** Show a built-in button that clears/resets the conversation. */
  showClearButton?: boolean;
  showJumpToBottomButton?: boolean;
  /**
   * Render a locale-aware per-message timestamp under each message bubble, sourced from
   * `Message.createdAt`. Off by default; messages without a `createdAt` render no time.
   */
  showTimestamps?: boolean;
  /**
   * Override the built-in locale-aware timestamp formatting used when `showTimestamps` is enabled.
   * Receives the message's `createdAt` string and the message itself. Defaults to a short,
   * locale-aware time of day.
   */
  formatTimestamp?: MessageTimestampFormatter<TMeta>;
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
