import type { Attachment, Message, MessageSource, ToolMessage } from '../../types';
import type { ConnectorToolDelta } from '../../connectors/connectors';
import type { SendCallbacks } from '../useChorusStream';

/**
 * Optional arguments for `helpers.finalizeAssistant(options?)`. Both fields are
 * applied to the pending assistant message immediately before the turn
 * completes, so a custom `onSend` can produce a finished reply with usage
 * telemetry in a single call (drives `<Chorus showCost>` on the `onSend` path).
 */
export interface ChorusFinalizeAssistantOptions {
  /**
   * Final assistant text appended before the turn completes. Use this for a
   * non-streaming `onSend` that produces the whole reply at once; omit it when
   * you already streamed the text through `helpers.appendAssistant()` (passing
   * it again would duplicate the text).
   */
  text?: string;
  /**
   * Metadata shallow-merged onto the pending assistant message's `metadata`
   * before completion (existing keys are overwritten). Attach `{ usage, modelId }`
   * here to make `<Chorus showCost>` work from `onSend`: `usage` is run through the
   * same normalizer the built-in connectors use, so the cost meter accepts the raw
   * provider field names — `{ input_tokens, output_tokens }` (Anthropic / OpenAI
   * Responses), `{ prompt_tokens, completion_tokens }` (OpenAI Chat), Gemini's
   * `{ promptTokenCount, candidatesTokenCount }`, the AI SDK's
   * `{ inputTokens, outputTokens }` — as well as the normalized
   * `{ promptTokens, completionTokens, totalTokens }` shape. `modelId` falls back to
   * the `<Chorus modelId>` prop when omitted.
   */
  metadata?: Record<string, unknown>;
}

export interface ChorusSendHelpers {
  appendAssistant: (chunk: string) => void;
  appendReasoning?: (chunk: string) => void;
  /** Attach a source/citation to the active assistant message. */
  appendSource?: (source: MessageSource) => void;
  /**
   * Render a `role: 'tool'` row in the transcript from an accumulated connector
   * tool delta. This helper is **presentation only**: unlike the `transport`
   * send path, it does NOT execute registered `tools` handlers, fire
   * `onToolCall` / `onToolDelta`, or drive the `autoContinueTools` loop, so the
   * row's `toolCall.output` stays unset unless you fill it in.
   *
   * On the `onSend` path you own tool execution. After running the tool
   * yourself, populate the row by calling `appendToolDelta` again with the same
   * `delta.id` and an `output` (deltas merge by id), and stream the model's
   * follow-up turn with `appendAssistant`.
   */
  appendToolDelta?: (delta: ConnectorToolDelta) => void;
  /**
   * Complete the assistant turn. Call with no arguments after streaming through
   * `appendAssistant()`, or pass `{ text, metadata }` to set the final text
   * and/or attach metadata to the pending assistant message in one shot — the
   * supported recipe for driving `<Chorus showCost>` from a custom `onSend`
   * (`finalizeAssistant({ text, metadata: { usage } })`). The merge runs before
   * the turn closes, so the finalized `Message` (and `onFinish`) carry the usage.
   * See {@link ChorusFinalizeAssistantOptions}.
   */
  finalizeAssistant: (options?: ChorusFinalizeAssistantOptions) => void;
  /**
   * Complete callback set for bridging `useChorusStream(...).send()` through
   * `onSend` — `{ onChunk, onReasoning, onSource, onToolDelta, onWarning, onMetadata,
   * onDone, onError }`. `onMetadata` attaches the connector's `usage` to the
   * streaming assistant message (keyed by the live pending id, so it lands even
   * when usage arrives in the same tick as the first/final chunk) and forwards
   * to the `onStreamMetadata` prop — wire it for `<Chorus showCost>` parity on a
   * streamed `onSend`. The bundled `onError` surfaces a mid-stream failure
   * (the UI banner + the `onError` prop) and drops the half-streamed partial
   * even when `onSend` does not return or await the `send()` promise, so a
   * bridged send that errors cannot vanish silently.
   *
   * `minAssistantDelayMs` is applied by Chorus on this path (the first token
   * is buffered by the helpers). Do not also pass `minDelayMs` to `send()` on
   * the bridged path — the two delays stack and the first token can be held
   * up to roughly twice as long.
   */
  streamCallbacks?: () => SendCallbacks;
  signal: AbortSignal;
  /** The optional `systemPrompt` prop. Use it in custom `onSend` request mapping; it is not prepended to `messages` on the onSend path. */
  systemPrompt?: string;
}

/**
 * Custom send implementation for the advanced (non-`transport`) path.
 *
 * To produce an assistant turn, `onSend` must do exactly one of: stream via
 * `helpers.appendAssistant()` (then `helpers.finalizeAssistant()`), or return
 * a `Message`. An `onSend` that resolves without appending or returning a
 * message closes the turn silently — `sending` flips back off but no
 * `onFinish`/`onAbort`/`onError` observer fires (Chorus warns once in dev).
 * An `onSend` that does *both* — streams via the helpers AND returns a
 * `Message` — keeps the streamed output; the returned `Message` is ignored
 * (Chorus warns once in dev).
 *
 * The `messages` argument is a snapshot of the transcript captured when the
 * turn started. A `Message` returned from `onSend` is appended to the *live*
 * transcript when the promise resolves — not to that snapshot — so the
 * transcript must not be mutated while an `onSend` is in flight (resolving a
 * delete confirmation, a controlled host re-deriving the array in `onChange`,
 * or a persistence load). Mutating it mid-flight lands the returned assistant
 * message on a transcript that no longer matches what `onSend` reasoned about.
 * Stream via `helpers.appendAssistant()` instead of returning a `Message` if
 * the transcript can change during the turn.
 */
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

/**
 * Why a `transformRequest` callback is firing. `'initial'` precedes a turn
 * triggered by user input (send, retry, regenerate). `'tool-continuation'`
 * precedes an automatic follow-up request inside an `autoContinueTools` loop
 * — the transformer fires once per iteration so lorebook/RAG augmentation
 * reacts to fresh tool results, not just the original user turn.
 */
export type ChorusTransformRequestReason = 'initial' | 'tool-continuation';

/**
 * Read-only context passed to `transformRequest` immediately before each
 * outbound transport request is built. `messages` is the assembled history
 * **without** the system prompt (`historyWithSystemPrompt` runs after the
 * transformer so an overridden `systemPrompt` still lands at position 0).
 * `signal` is the active turn's `AbortSignal`; an async transformer must
 * cooperate with cancellation by awaiting fetch/work that honors it.
 */
export interface ChorusTransformRequestContext<TMeta = Record<string, unknown>> {
  /** Pre-request history snapshot (no system prompt prepended yet). */
  messages: Message<TMeta>[];
  /** The current `<Chorus systemPrompt>` value, or undefined when none is set. */
  systemPrompt: string | undefined;
  /** Cancellation signal for the active turn. Honor it in async work to avoid leaking transformer requests. */
  signal: AbortSignal;
  /** Why the transformer is firing for this request. */
  reason: ChorusTransformRequestReason;
}

/**
 * Optional overrides returned from `transformRequest`. Each field replaces the
 * value the request would otherwise carry; returning `undefined` (or
 * `void`/null) keeps the original value. Field semantics:
 *
 * - `messages` — replaces the outgoing history for **this request only**.
 *   Useful for lorebook injection, rolling summaries, RAG, author's notes —
 *   anything that augments the wire history without contaminating the
 *   persisted transcript.
 * - `systemPrompt` — replaces the `<Chorus systemPrompt>` value for this
 *   request. Use an empty string to suppress the system prompt entirely;
 *   omit the field to keep the configured value.
 *
 * `bodyExtras` for arbitrary request-body fields is intentionally deferred —
 * use `FetchTransportInit.body` or a custom `Transport` wrapper for that.
 */
export interface ChorusTransformRequestResult<TMeta = Record<string, unknown>> {
  messages?: Message<TMeta>[];
  systemPrompt?: string;
}

/**
 * Pre-send hook that mutates the outgoing transport request without
 * contaminating the persisted transcript. Runs on the `transport` path only
 * (the `onSend` path already has full control over the request). Fires once
 * per turn for plain sends and once per iteration inside an
 * `autoContinueTools` loop, with `reason` distinguishing the two.
 *
 * Idempotency contract: the transformer runs on retries and on every
 * tool-loop iteration. Keep side effects observation-only or pure — a
 * lorebook keyword scan, a rolling summary, a RAG retrieval call. Throwing
 * (or rejecting) ends the turn through the normal `onError` path; aborts
 * propagated via `ctx.signal` are silent.
 *
 * Returning `void`/`undefined` is equivalent to `{}` — keep the configured
 * messages and systemPrompt. The result's `messages`/`systemPrompt`
 * overrides replace the wire request only; the persisted transcript and the
 * `<Chorus systemPrompt>` prop remain unchanged.
 */
export type ChorusTransformRequest<TMeta = Record<string, unknown>> = (
  context: ChorusTransformRequestContext<TMeta>,
) => ChorusTransformRequestResult<TMeta> | void | Promise<ChorusTransformRequestResult<TMeta> | void>;

export interface UpdateMessagesOptions {
  flushPersistence?: boolean;
  removePersistenceIfEmpty?: boolean;
  /**
   * Route this update straight to the persistence write queue, bypassing the
   * controlled-host `onChange`, the uncontrolled `setInternalMsgs`, and the
   * `onMessagesChange` observer. Used by the `useRAFQueue` unmount flush so a
   * final buffered token is persisted without a host callback firing after the
   * component has torn down.
   */
  persistOnly?: boolean;
  reason?: 'send' | 'assistant' | 'retry' | 'edit' | 'regenerate' | 'delete' | 'clear' | 'error-cleanup' | 'update';
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
