import type { Attachment, Message, ToolMessage } from '../../types';
import type { ConnectorToolDelta } from '../../connectors/connectors';
import type { SendCallbacks } from '../useChorusStream';

export interface ChorusSendHelpers {
  appendAssistant: (chunk: string) => void;
  appendReasoning?: (chunk: string) => void;
  appendToolDelta?: (delta: ConnectorToolDelta) => void;
  finalizeAssistant: () => void;
  /** Complete callback set for bridging `useChorusStream(...).send()` through `onSend`. */
  streamCallbacks?: () => SendCallbacks;
  signal: AbortSignal;
  /** The optional `systemPrompt` prop. Use it in custom `onSend` request mapping; it is not prepended to `messages` on the onSend path. */
  systemPrompt?: string;
}

export type ChorusOnSend<TMeta = Record<string, unknown>> = (
  text: string,
  messages: Message<TMeta>[],
  helpers: ChorusSendHelpers,
) => Promise<Message<TMeta> | void> | Message<TMeta> | void;

export interface ChorusFinishContext<TMeta = Record<string, unknown>> {
  message: Message<TMeta>;
  messages: Message<TMeta>[];
  reason: 'done' | 'returned-message';
  response?: Response;
}

export type ChorusOnFinish<TMeta = Record<string, unknown>> = (context: ChorusFinishContext<TMeta>) => void;

export interface ChorusDeleteMessageContext<TMeta = Record<string, unknown>> {
  message: Message<TMeta>;
  messages: Message<TMeta>[];
}

export type ChorusConfirmDeleteMessage<TMeta = Record<string, unknown>> = (context: ChorusDeleteMessageContext<TMeta>) => boolean | void | Promise<boolean | void>;

export type ChorusAbortReason = 'stop' | 'clear' | 'superseded';
export type ChorusAbortSource = 'user' | 'programmatic';

export interface ChorusClearConversationContext<TMeta = Record<string, unknown>> {
  messages: Message<TMeta>[];
  resetToInitialMessages: boolean;
  source: ChorusAbortSource;
  persistenceKey?: string;
}

export type ChorusConfirmClearConversation<TMeta = Record<string, unknown>> = (
  context: ChorusClearConversationContext<TMeta>,
) => boolean | void | Promise<boolean | void>;
export type ChorusSendPath = 'transport' | 'onSend';

export interface ChorusAbortContext<TMeta = Record<string, unknown>> {
  /** Partial assistant message finalized by the abort, or null when no assistant token had rendered yet. */
  message: Message<TMeta> | null;
  /** Message list at the moment the abort was reported. Clear/reset happens after this callback for clear-triggered aborts. */
  messages: Message<TMeta>[];
  /** Why the active generation was cancelled. */
  reason: ChorusAbortReason;
  /** Whether the cancellation came from built-in user UI or imperative/internal control flow. */
  source: ChorusAbortSource;
  /** Active send implementation that was cancelled. */
  path: ChorusSendPath;
}

export type ChorusOnAbort<TMeta = Record<string, unknown>> = (context: ChorusAbortContext<TMeta>) => void;

export interface ChorusToolDeltaContext<TMeta = Record<string, unknown>> {
  delta: ConnectorToolDelta;
  message: ToolMessage<TMeta>;
  messages: Message<TMeta>[];
}

export type ChorusOnToolDelta<TMeta = Record<string, unknown>> = (context: ChorusToolDeltaContext<TMeta>) => void;

export interface ChorusToolCallContext<TMeta = Record<string, unknown>> {
  id: string;
  name: string;
  input?: unknown;
  output?: unknown;
  message: ToolMessage<TMeta>;
  messages: Message<TMeta>[];
  signal: AbortSignal;
}

export type ChorusOnToolCall<TMeta = Record<string, unknown>> = (context: ChorusToolCallContext<TMeta>) => unknown | Promise<unknown>;
export type ChorusToolHandler<TMeta = Record<string, unknown>> = (input: unknown, context: ChorusToolCallContext<TMeta>) => unknown | Promise<unknown>;

/**
 * Why a transport stream's tool-loop iteration ended. Hosts that opt in to `autoContinueTools` use this to
 * distinguish a normal terminal completion from the safety cap firing (`'max-tool-iterations'`), a host veto
 * (`'tool-loop-veto'`), or an intermediate iteration that will continue (`'tool-loop-continue'`). The
 * `'max-tool-iterations'` reason is callback-only; Chorus deliberately does not render a default banner so
 * hosts can choose how to surface or recover from the cap.
 */
export type ChorusStreamDoneReason =
  | 'completed'
  | 'tool-loop-continue'
  | 'tool-loop-veto'
  | 'max-tool-iterations';

export interface ChorusStreamDoneContext<TMeta = Record<string, unknown>> {
  assistantMessage: Message<TMeta> | null;
  toolMessages: ToolMessage<TMeta>[];
  messages: Message<TMeta>[];
  response?: Response;
  /** Why this stream ended. See {@link ChorusStreamDoneReason}. */
  reason: ChorusStreamDoneReason;
  /** Whether Chorus will immediately start another tool-loop continuation after this callback returns. */
  willContinue: boolean;
  /** 1-based count of completed tool-loop iterations on this turn (always >= 1). */
  iteration: number;
  /** Normalized cap (after defaulting and `Infinity` handling) used to evaluate the loop. */
  maxToolIterations: number;
}

export type ChorusOnStreamDone<TMeta = Record<string, unknown>> = (context: ChorusStreamDoneContext<TMeta>) => void;

export interface ChorusToolLoopContext<TMeta = Record<string, unknown>>
  extends Omit<ChorusStreamDoneContext<TMeta>, 'reason' | 'willContinue'> {
  /** Number of completed tool-execution iterations, starting at 1 for the first continuation. */
  iteration: number;
  maxToolIterations: number;
  signal: AbortSignal;
}

export type ChorusShouldContinueToolLoop<TMeta = Record<string, unknown>> = (context: ChorusToolLoopContext<TMeta>) => boolean | Promise<boolean>;

export interface UpdateMessagesOptions {
  flushPersistence?: boolean;
  removePersistenceIfEmpty?: boolean;
  reason?: 'send' | 'assistant' | 'retry' | 'edit' | 'regenerate' | 'delete' | 'clear' | 'update';
}

export type UpdateSessionMessages<TMeta> = (
  updater: (prev: Message<TMeta>[]) => Message<TMeta>[],
  options?: UpdateMessagesOptions,
) => Message<TMeta>[];

export interface SubmittedUserTurn<TMeta = Record<string, unknown>> {
  text: string;
  history: Message<TMeta>[];
}

export type SendArguments = [text: string, attachments?: Attachment[]];
