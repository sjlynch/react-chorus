import type React from 'react';
import type { RenderAttachmentErrorContext } from './components/ChatInput';
import type { GetMessageFeedback, MessageCopyResult, MessageFeedback, MessageMarkdownProps, MessageTimestampFormatter, RenderErrorContext, RenderMessageContext } from './components/ChatWindow';
import type { Palette } from './components/ChorusTheme';
import type { MarkdownSanitizer } from './components/Markdown';
import type { Connector, ConnectorWarning } from './connectors/connectors';
import type { FetchTransportInit } from './hooks/assistant-session/transport';
import type { ChorusConfirmClearConversation, ChorusConfirmDeleteMessage, ChorusOnAbort, ChorusOnFinish, ChorusOnSend, ChorusOnStreamDone, ChorusOnToolCall, ChorusOnToolDelta, ChorusShouldContinueToolLoop, ChorusToolRegistry, ChorusTransformRequest } from './hooks/useAssistantSession';
import type { ChorusMessagesChangeContext } from './hooks/useChorusMessages';
import type { DeserializeMessages, SerializeMessages } from './hooks/useChorusPersistence';
import type { Transport } from './hooks/useChorusStream';
export type { ChorusProviderConfig } from './chorus-shell/multiProvider';
import type { ChorusProviderConfig } from './chorus-shell/multiProvider';
import type { ChorusLabels } from './labels/types';
import type { ArtifactVersion, AttachmentError, ConnectorName, Message, Role, StorageAdapter, UploadAttachment } from './types';
import type { ChorusConnectorOptions } from './Chorus.defaults';
import type { ConversationMetadata } from './hooks/useConversationMetadata';
import type { McpServerConfig } from './mcp/types';
import type { ChorusToolPolicy, ToolPolicyScope } from './approvals/types';
import type { BlockRegistry, ToolLoadingComponents } from './blocks/types';
import type { BudgetExceededContext } from './chorus-shell/useCostMeter';
import type { PricingTable } from './pricing';

export type { BudgetExceededContext } from './chorus-shell/useCostMeter';
export type { ModelPricing, PricingTable } from './pricing';

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
  /**
   * Browser-side MCP servers to connect on mount. MCP tools are merged into
   * the executable tool registry; prompts/resources surface in the composer.
   *
   * Change detection is by stable JSON serialization of each server's
   * `name`, `url`, `transport`, `headers`, and reconnect tuning fields, so
   * passing a referentially new array with the same content is safe (no
   * reconnect). To rotate a credential, re-pass the entire `mcpServers`
   * array with a fresh `headers` object holding the new value — mutating
   * `server.headers` in place will NOT trigger a reconnect.
   */
  mcpServers?: McpServerConfig[];
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
  /**
   * Per-tool approval policy. `default` applies to any `requiresApproval` tool
   * without a `perTool` override. With `default: 'ask'` the tool row renders a
   * three-button approval card (Allow once / Allow always / Deny) and pauses
   * execution until the user decides. `'allow'` runs the tool; `'deny'`
   * records a `(denied by user)` tool-error result. Tools without
   * `requiresApproval` and the reserved UI tools (`__render_block`,
   * `__artifact`) are always exempt.
   */
  toolPolicy?: ChorusToolPolicy;
  /**
   * Where "Allow always for this tool" persists the per-tool override.
   * Defaults to `'conversation'`: writes to the same `persistenceStorage`
   * under `${persistenceKey}::tool-policy`. `'session'` keeps overrides in
   * memory only; `'global'` writes to a fixed key (`chorus:tool-policy`) so
   * the user's choices follow them across conversations.
   */
  toolPolicyScope?: ToolPolicyScope;
  /**
   * Maximum time, in milliseconds, that an `ask`-policy approval will wait
   * before resolving as a deny with a visible `(approval timed out)` tool
   * result. Defaults to 5 minutes. `0` or `Infinity` disables the timeout.
   */
  approvalTimeoutMs?: number;
  /** Called when Chorus cannot read, deserialize, write, or remove the transcript in persistenceStorage. */
  onPersistenceError?: (error: Error) => void;
  onSend?: ChorusOnSend<TMeta>;
  /**
   * Free-form, conversation-scoped slot persisted alongside the transcript at
   * `${persistenceKey}::meta` in `persistenceStorage`. Designed for
   * roleplay/multi-agent shells that need a small object (active character id,
   * persona id, lorebook id, author's note) per conversation without pinning
   * it onto every message.
   *
   * Controlled: pair with `onConversationMetadataChange` so Chorus can lift
   * the loaded value into host state when the conversation key changes. Pass
   * `null` to clear the persisted slot. Pass `undefined` (or omit) to opt
   * out — Chorus will not write a metadata slot. Persistence requires both
   * `persistenceKey` and `persistenceStorage`; without them this prop is a
   * no-op and host-supplied state is the only source of truth.
   */
  conversationMetadata?: ConversationMetadata | null;
  /**
   * Called once per persistenceKey when a stored conversation metadata value
   * is loaded and differs from the current `conversationMetadata` prop. Host
   * uses this to lift the loaded slot into state so the prop matches storage
   * on subsequent renders. Throws are caught and warned in development.
   */
  onConversationMetadataChange?: (next: ConversationMetadata) => void;
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
   * Render `message.speaker.avatarUrl` as a small circular avatar next to the
   * visible speaker name above each bubble. The speaker name itself renders
   * unconditionally whenever a message carries `speaker`; only the avatar
   * image is gated by this prop. Off by default so single-character chat
   * transcripts stay unchanged. Pair with `MessageSpeaker` on messages —
   * useful for multi-agent and roleplay shells.
   */
  showSpeakerAvatars?: boolean;
  /**
   * Override the built-in locale-aware timestamp formatting used when `showTimestamps` is enabled.
   * Receives the message's `createdAt` string and the message itself. Defaults to a short,
   * locale-aware time of day.
   */
  formatTimestamp?: MessageTimestampFormatter<TMeta>;
  suggestedPrompts?: string[];
  /** Hidden system prompt. Prepended to transport history; exposed as helpers.systemPrompt on the onSend path. */
  systemPrompt?: string;
  /**
   * Optional pre-send hook fired immediately before each outbound transport
   * request. Use it for lorebook injection, rolling summaries, RAG retrieval,
   * author's notes, or any other context augmentation that should NOT land in
   * the persisted transcript. Runs on the `transport` path only — the
   * `onSend` path already owns the request fully.
   *
   * Fires once per turn for plain sends and once per iteration inside an
   * `autoContinueTools` loop, with `reason` distinguishing the two. The
   * hook receives the assembled history (without the system prompt) plus
   * the current `systemPrompt` value, and may return overrides:
   *
   * ```ts
   * transformRequest={async ({ messages, signal }) => {
   *   const lore = await scanLorebook(messages, signal);
   *   return {
   *     messages: lore.length
   *       ? [{ role: 'system', text: lore.join('\n'), id: 'lorebook' }, ...messages]
   *       : messages,
   *   };
   * }}
   * ```
   *
   * Throwing/rejecting ends the turn through the normal `onError` path;
   * aborts propagated via `ctx.signal` are silent. See
   * `ChorusTransformRequest` for the full contract.
   */
  transformRequest?: ChorusTransformRequest<TMeta>;
  /** Simple path: URL string, `{ url, headers, credentials, ... }` config object, or a custom `Transport` function. */
  transport?: string | FetchTransportInit<TMeta> | Transport<TMeta>;
  /**
   * Multi-provider registry keyed by stable provider id. Each entry pairs a
   * `transport` (URL string, `FetchTransportInit`, or custom `Transport`)
   * with the connector name to parse its SSE frames, plus an optional
   * human-readable `label` for the composer model picker and an optional
   * `modelId` propagated to `message.modelId` / cost-meter pricing lookups.
   *
   * When set, the composer renders a model-picker dropdown next to the send
   * button, the `/model:<id>` slash command switches the active provider for
   * the next turn, and each assistant message records the routed provider on
   * `message.provider`. The conversation-level `transport` / `connector` props
   * remain the fallback used when no provider is active.
   */
  providers?: Record<string, ChorusProviderConfig<TMeta>>;
  /**
   * Provider id selected by default when `providers` is configured. Must be
   * a key of `providers`. Ignored when `providers` is omitted.
   */
  defaultProvider?: string;
  uploadAttachment?: UploadAttachment;
  value?: Message<TMeta>[];
  /**
   * Generative-UI block registry. Keyed by block name; the assistant emits a
   * `__render_block` tool call with `{ name, props }` and Chorus maps it to
   * `message.block`. The default transcript renders the registered component
   * inline (no tool row), re-rendering on every streamed prop delta. Each
   * block definition can optionally provide a validator (run on `'done'`)
   * and a `streamingMode: 'whole'` to defer rendering until done. Unknown
   * names render a small fallback so old transcripts still load.
   */
  blocks?: BlockRegistry;
  /**
   * Per-tool loaders displayed while a tool call is streaming and has no
   * output yet. Pass a record `{ get_weather: WeatherLoader }` or a function
   * `(toolName, partialInput) => ReactNode` to react to streamed input. Tools
   * without an override use a 3-dot default loader.
   */
  toolLoadingComponents?: ToolLoadingComponents;
  /**
   * Show a small `$0.003 · 412 tok` chip at the bottom-right of each assistant
   * bubble plus a conversation total in the transcript header. Off by default.
   *
   * Pricing comes from the built-in `PRICING` snapshot (see `react-chorus/pricing`)
   * merged with the optional `pricing` prop on top — host overrides win per
   * model. Costs are computed from `metadata.usage` on each assistant message;
   * the built-in connectors emit usage via `onStreamMetadata` and the meter
   * attaches it to the active streaming message automatically.
   */
  showCost?: boolean;
  /**
   * Per-model pricing overrides (USD per 1k tokens). Merged on top of the
   * built-in `PRICING` snapshot, so partial overrides win per model without
   * dropping the defaults for unmentioned models. Ship a fresh snapshot from
   * your billing system here when the built-in table goes stale.
   */
  pricing?: PricingTable;
  /**
   * Fallback model id used when an assistant message has no
   * `metadata.modelId`. Useful for single-provider apps that always route
   * through one model — set it once and the meter picks the correct pricing
   * entry without each message carrying the id.
   */
  modelId?: string;
  /**
   * Host-supplied per-message cost override. Returns the USD cost for one
   * assistant message; return `undefined` to fall back to the built-in
   * pricing-table lookup. Useful for custom billing (e.g. cached input
   * discounts, batch pricing) that the static table cannot express.
   */
  costEstimator?: (message: Message<TMeta>, modelId: string | undefined) => number | undefined;
  /**
   * Conversation budget threshold in USD. Once the running total strictly
   * exceeds this, `onBudgetExceeded` fires exactly once. The latch re-arms
   * when the total drops back at or below the threshold (e.g. after a
   * `clear()`), so the next over-budget run still alerts.
   */
  budgetAlert?: number;
  /**
   * Fires once when the conversation total crosses `budgetAlert`. Receives
   * `{ total, perModel, threshold }`. Pure observer — throwing here does
   * not interrupt rendering.
   */
  onBudgetExceeded?: (context: BudgetExceededContext) => void;
  /**
   * Localized labels for every built-in UI string: composer placeholder/aria-labels
   * (including the slash-command palette, MCP resource picker, and model picker),
   * transcript aria-label/typing/retry/jump/empty title, message actions, speakers,
   * tool call sections, reasoning summary, code-copy button, the clear button, the
   * cost meter (`cost`), artifact panel/cards (`artifacts`), MCP status line (`mcp`),
   * and the tool-approval card (`approval`). Defaults preserve the current English
   * strings; the existing `placeholder`, `disabledReason`, and `clearLabel` props
   * take precedence when provided. Starter blocks (Form/Calendar/Image) localize via
   * their own targeted props since they render content from a model-driven payload.
   */
  labels?: ChorusLabels;
  /**
   * Render a `react` artifact through a host-supplied block registry. Called
   * with the active `ArtifactVersion` when the side panel needs to show a
   * `kind: 'react'` artifact. The returned element is rendered inside an
   * error boundary in the panel body. Without a handler, react artifacts
   * fall back to a placeholder message — pairs with the Generative-UI block
   * registry task.
   */
  renderReactArtifact?: (version: ArtifactVersion) => React.ReactNode;
}
