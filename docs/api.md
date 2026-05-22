# API reference

The complete prop, hook, and component reference for react-chorus. For task-oriented walkthroughs see the [usage guide](guide.md); for deployment concerns see the [deployment notes](deployment.md).

## API

### `<Chorus>`

`ChorusProps` is generic: `ChorusProps<TMeta = Record<string, unknown>>`. Use `<Chorus<MyMeta> ... />` when your `Message.metadata` has a structured shape; `value`, `onChange`, `onSend`, `transport`, and `renderMessage` will all preserve `Message<MyMeta>`.

Message source modes are mutually exclusive:

- Controlled: pass `value` + `onChange` and keep the canonical message list in your state.
- Uncontrolled with a seed: pass `initialMessages` (or legacy `messages`) and let Chorus manage subsequent updates internally.
- Uncontrolled with persistence: pass `persistenceKey` without `value`; passing both makes `value` win, so built-in persistence is bypassed without reading the ignored key.

`initialMessages` (and legacy `messages`) follow a **frozen-seed contract**: the seed is captured once at mount and never re-derived. If a parent rebuilds the seed array after mount — for example regenerating welcome messages on a locale, theme, or persona change — the new array is silently ignored: the transcript does not re-seed, and `resetToInitialMessages` still restores the mount-time value. In development Chorus logs a one-time warning when the reference changes. To swap the transcript at runtime, use controlled mode (`value` + `onChange`), call `ChorusRef.clear()`, or force a fresh mount with `key={...}`.

When `persistenceKey` is combined with `initialMessages` (or legacy `messages`), stored history is checked first. If the key has no stored value, Chorus renders and saves the seed so welcome messages still appear with persistence enabled. If the key already exists, the stored value wins. Promise-based storage adapters keep the built-in composer and write actions disabled while the initial read is pending; the seed/empty-state prompts stay hidden until the read resolves so a pre-load Send cannot overwrite an existing transcript.

Persistence writes are debounced while assistant tokens stream, flushed when a message finalizes and on explicit edits/deletes/clears, and serialized for async adapters so older saves cannot overwrite newer transcripts. Pending debounced writes are also flushed on `pagehide` and `visibilitychange` → `hidden`; synchronous adapters such as `localStorage` can complete that final write during tab close, while Promise-based adapters cannot block navigation. If you wire `useChorusPersistence()` into your own controlled state, gate your custom composer on `persist.loaded` (or intentionally queue your own edits) before calling `persist.onChange`. For remote/IndexedDB persistence, prefer a synchronous localStorage fallback plus an async backup when data loss on close is unacceptable.

Built-in persistence uses `JSON.stringify` / `JSON.parse` by default. Message data must be JSON-serializable: Dates are restored as strings, classes are not revived, and values such as `BigInt` fail serialization and surface through `onPersistenceError` / `useChorusPersistence().error`. Read, deserialization, write, and remove failures are reported with `error.key` and `error.operation` (`'read' | 'deserialize' | 'write' | 'remove'`) while Chorus keeps rendering a safe empty fallback when needed. Pass `serializeMessages` and/or `deserializeMessages` to customize validation, compression, or Date revival.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `transport` | `string \| FetchTransportInit<TMeta> \| Transport<TMeta>` | — | Simple path: a URL to POST to, a `{ url, headers, credentials, method, … }` config object (`FetchTransportInit`), or a custom Transport function. Chorus handles all streaming. |
| `systemPrompt` | `string` | — | Hidden instruction for both send paths. With `transport`, Chorus prepends it as a `system` message in request history (using the reserved id `RESERVED_SYSTEM_PROMPT_ID`); the synthetic row is never stored on the transcript. With `onSend`, read it from `helpers.systemPrompt`; `messages` is left unchanged to avoid duplicates. The value is read at send time, so swapping it at runtime takes effect on the next Send / Retry / Regenerate — see [Changing the system prompt at runtime](guide.md#changing-the-system-prompt-at-runtime) for multi-persona toggles, Regenerate semantics, and precedence vs. a host-supplied `role: 'system'` row. |
| `connector` | `Connector \| 'auto' \| 'openai' \| 'anthropic' \| 'gemini' \| 'ai-sdk'` | `'auto'` | SSE connector used to parse the stream. `'auto'` detects OpenAI, Anthropic, Gemini, and Vercel AI SDK frames; pass an explicit name when the format is known. |
| `connectorOptions` | `OpenAIConnectorOptions` | — | Options forwarded to the built-in connector resolved from a `connector` string. Currently only the `'openai'` connector consumes options (e.g. `{ thinkTag }` for a custom reasoning tag pair). Ignored for other names and for custom `Connector` objects — build those with `createOpenAIConnector(options)`. |
| `onSend` | `(text, messages, helpers) => Message<TMeta> \| void \| Promise<Message<TMeta> \| void>` | — | Advanced path: called when the user submits a message. Use `helpers.appendAssistant`/`helpers.finalizeAssistant` to stream tokens, or return a complete assistant `Message` for non-streaming replies. |
| `value` | `Message<TMeta>[]` | — | Controlled message list. Pair with `onChange`; Chorus renders this array as the source of truth. |
| `onChange` | `(messages: Message<TMeta>[]) => void` | — | Called whenever Chorus wants to change the message list in controlled mode (`value` is provided). Not called for legacy `messages`-only uncontrolled state. |
| `onMessagesChange` | `(messages, context) => void` | — | Read-only transcript observer for controlled, uncontrolled, and persistence-backed modes. Fires for initial/loaded messages, sends, stream chunks, returned messages, edits, deletes, retry/regenerate truncation, and clear without making Chorus controlled. `context.source` is `'controlled'`, `'uncontrolled'`, or `'persistence'`. |
| `messages` | `Message<TMeta>[]` | — | Legacy initial-only seed for uncontrolled mode. Read once on mount; later prop changes are ignored (dev warns once on a reference change). Prefer `initialMessages` for seeding or `value` + `onChange` for controlled mode. |
| `initialMessages` | `Message<TMeta>[]` | — | Initial-only seed for uncontrolled mode, captured once at mount (frozen-seed contract — later reference changes are ignored and dev-warned once). Useful for welcome messages; `system` messages are hidden by default via `hiddenRoles`. Tool calls remain visible by default. To seed from a server-fetched transcript (Next.js loader / `getServerSideProps`) and keep follow-up turns cached in the browser via `persistenceKey`, see the [Server-side history pre-load](guide.md#server-side-history-pre-load) recipe — it documents the precedence rule when both seeds collide and the `useId` pattern for fresh conversations. |
| `emptyState` | `ReactNode` | — | Custom content shown in the transcript when the visible message list is empty and the assistant is not typing. |
| `suggestedPrompts` | `string[]` | — | Default empty-state prompt buttons. Clicking one fills and focuses the composer without sending. Ignored when `emptyState` is provided. |
| `placeholder` | `string` | `"Send a message"` | Input placeholder text. |
| `disabled` | `boolean` | `false` | Disables composer text input, attach/paste/drop ingestion, Send, suggested-prompt fills, retry/clear, and message write actions. If an assistant response is active, Stop remains available so work is not stranded. |
| `readOnly` | `boolean` | `false` | Keeps transcript read actions such as copy and scrolling available, but prevents compose, attachments, send, edit, regenerate, delete, retry, clear, feedback, and suggested-prompt fills. |
| `disabledReason` | `string` | — | Explanation shown through the composer placeholder/title and accessible description while `disabled` or `readOnly` is active (for example “Select a conversation first”). |
| `alwaysShowMessageActions` | `boolean` | `false` | Always render the per-message action buttons (edit/regenerate/copy/feedback/delete) instead of revealing them on hover. Coarse-pointer / `@media (hover: none)` devices get the same always-visible behavior automatically so touch users can discover and tap actions; this prop opts pointer devices in too. |
| `accept` | `string` | — | Enables attachments and is forwarded to the file-picker `<input accept>`. Paste/drop validation uses the same MIME/extension rules. Omitting the prop hides the attach button and disables paste/drop attachments. |
| `maxAttachmentBytes` | `number` | — | Reject files larger than this byte limit before reading/uploading them. |
| `maxAttachments` | `number` | — | Maximum attachments queued in the composer at once. Extra files trigger `onAttachmentError`. |
| `maxRenderedMessages` | `number` | — | Performance escape hatch: render only the latest N visible messages while keeping typing/error rows, auto-scroll, and actions wired to original message IDs. |
| `onAttachmentError` | `(error: AttachmentError) => void` | — | Called when a picker, paste, or drop file is rejected or cannot be read/uploaded. Reasons include `unsupported-type`, `too-large`, `too-many`, `read-failed`, and `upload-failed`. |
| `uploadAttachment` | `(file: File, options?: { signal: AbortSignal }) => AttachmentUploadResult \| Promise<AttachmentUploadResult>` | data URL reader | Optional transform/upload hook. Return a custom attachment (for example a CDN URL or provider file id) instead of the default data URL payload. The signal aborts when pending work is cancelled. |
| `sending` | `boolean` | — | Visual sending-state override for fully custom `onSend`/`useChorusStream` integrations. On the `transport` path, Chorus still owns the internal concurrency guard even if this is overridden. |
| `palette` | `Palette` | dark theme | Custom color palette for theming chat chrome, actions, errors, and built-in tool call blocks. |
| `codeBlockTheme` | `'dark' \| 'light'` | `'dark'` | Code block syntax-highlight theme. |
| `minAssistantDelayMs` | `number` | `300` | Minimum ms before showing the first assistant token. |
| `errorMessage` | `string` | `'Something went wrong. Please try again.'` | Friendly message shown in the error banner. Raw transport errors are never surfaced in the default UI. |
| `onError` | `(error: Error) => void` | — | Called for any non-abort error from a send or stream. The raw `Error` goes here; the UI shows `errorMessage`. |
| `onAbort` | `({ message, messages, reason, source, path }) => void` | — | Called when an active assistant generation is cancelled by Stop, `ref.stop()`, clear-while-sending, or a superseding session. `message` is the finalized partial assistant message or `null` before the first token; `path` is `'transport'` or `'onSend'`; `reason` is `'stop'`, `'clear'`, or `'superseded'`; `source` is `'user'` for built-in UI actions and `'programmatic'` for imperative/internal cancellation. |
| `renderError` | `({ error, rawError, retry, dismiss }) => ReactNode` | — | Replace the built-in error banner. `error` is the friendly UI string, `rawError` is the last raw `Error` when available, `retry()` resubmits the last turn, and `dismiss()` clears the banner. |
| `onChunk` | `(chunk: string, messageId: string) => void` | — | Observation hook called for each streamed assistant **text** token. Receives the assistant `messageId` so callers can correlate chunks with a specific message. Text content only — reasoning/thinking deltas and tool-call deltas do **not** trigger it. Does **not** affect streaming behaviour. |
| `onToolDelta` | `({ delta, message, messages }) => void` | — | Observation hook called for every accumulated streamed tool-call delta on the `transport` path. Does **not** affect execution. Transport-path only — never fires on the `onSend` path (a dev warning flags this). |
| `onToolCall` | `({ id, name, input, output, message, messages, signal }) => unknown \| Promise<unknown>` | — | Called after stream input completes for each streamed tool call. If no matching `tools[name]` handler exists, a non-`undefined` return value is appended as `toolCall.output`. Transport-path only — never fires on the `onSend` path, where you execute tools yourself (a dev warning flags this). |
| `tools` | `Record<string, (input, context) => unknown \| Promise<unknown>>` | — | Executable tool registry keyed by tool name. Matching handlers run after the stream completes; their return value is appended to the tool message as output. Transport-path only — registered handlers never run on the `onSend` path, where you execute tools yourself (a dev warning flags this). |
| `autoContinueTools` | `boolean` | `false` | Opt in to an automatic tool-execution → model-continuation loop on the `transport` path after all completed tool calls have outputs. |
| `maxToolIterations` | `number` | `4` | Maximum automatic tool iterations when `autoContinueTools` is enabled. Prevents infinite loops. |
| `continueOnToolError` | `boolean` | `false` | Treat a thrown tool handler (or `onToolCall`) error as a normal tool result instead of a terminal turn failure. The error is recorded on the tool row (`{ error: message }` output plus `metadata.isError`); with `autoContinueTools` enabled the loop continues, feeding the error tool result back to the model so it can self-recover. Abort errors (Stop) always end the turn. Transport-path only — has no effect on the `onSend` path, where you execute tools yourself (a dev warning flags this). |
| `shouldContinueToolLoop` | `(context) => boolean \| Promise<boolean>` | — | Optional gate before each automatic continuation. Return `false` to stop after rendering/executing the current tool batch. |
| `onStreamDone` | `({ assistantMessage, toolMessages, messages, response, reason, willContinue, iteration, maxToolIterations }) => void` | — | Called after each `transport` stream completes normally and tool handlers (if any) finish. Fires for tool-only turns where `onFinish` has no assistant message. `reason` is `'completed'`, `'tool-loop-continue'`, `'tool-loop-veto'`, or `'max-tool-iterations'` — use it to detect when `autoContinueTools` stops because the safety cap was reached. |
| `onStreamWarning` | `(warning: ConnectorWarning) => void` | — | Observation hook for non-fatal connector warnings on the `transport` path (`{ code, message, payload? }`) — e.g. a `truncated` warning when the model hit its max-token limit, or safety-rating notices. The stream still completes normally (`onFinish`/`onStreamDone` fire as usual); use it to tell the user the response may be cut off or partially blocked. A throwing handler is warned in development and otherwise ignored. |
| `onStreamMetadata` | `(metadata: Record<string, unknown>) => void` | — | Observation hook for free-form provider metadata on the `transport` path as connectors emit it — OpenAI Responses token `usage`, Anthropic `stopReason`/`stopSequence`, Gemini `safetyRatings`/`finishReason`, OpenAI Chat `finishReason`. Fires once per connector result that carries metadata, so it may be called several times per turn; the stream still completes normally. Wire it for usage/cost telemetry (e.g. a live budget meter) or to persist safety ratings. A throwing handler is warned in development and otherwise ignored. |
| `onCopy` | `(message: Message<TMeta>) => MessageCopyResult` | Clipboard copy when available | Overrides the built-in per-message Copy action. Return `false` (or `Promise<false>`) to show the "Copy failed" indicator; return `void` to keep the assume-success behavior. If omitted, Chorus copies `message.text` with `navigator.clipboard.writeText` when the Clipboard API is available. |
| `getMessageFeedback` | `(message: Message<TMeta>) => 'up' \| 'down' \| null \| undefined` | `message.metadata.feedback` | Seeds the pressed thumb state from persisted feedback. Return `null` for no selection; return `undefined` to fall back to `message.metadata.feedback` when it is `'up'` or `'down'`. |
| `onFeedback` | `(message: Message<TMeta>, feedback: 'up' \| 'down' \| null) => void` | — | Enables built-in thumbs-up / thumbs-down per-message feedback actions and reports changes. Clicking the already-selected thumb toggles the rating off and reports `null` so a mis-click can be undone. |
| `confirmDeleteMessage` | `({ message, messages }) => boolean \| void \| Promise<boolean \| void>` | — | Optional gate for built-in message delete actions. Return or resolve `false` to cancel; persistence is flushed only after deletion is confirmed. |
| `onFinish` | `({ message, messages, reason, response }) => void` | — | Called once when an assistant message completes normally. Use it for telemetry, persistence handoff, moderation, or post-response UI. Not called for tool-only turns, aborts, Stop, or errors; use `onAbort` for cancellation telemetry and `onStreamDone`/`onToolCall` for tool-only streams. |
| `persistenceKey` | `string` | — | Uncontrolled-mode persistence key. When set without `value`, Chorus saves/restores messages using this key (defaults to localStorage). If `value` is provided, controlled state wins and built-in persistence is not used. |
| `persistenceStorage` | `StorageAdapter` | `localStorage` | Custom storage adapter for persistenceKey. The default `localStorage` is resolved lazily; if browser storage is blocked or unavailable, Chorus keeps working without persistence. Implement optional `removeItem(key)` to delete unseeded empty transcripts and deleted conversation keys; seeded clears persist `[]` so the clear survives reloads. |
| `onPersistenceError` | `(error: Error & { key?: string; operation?: string }) => void` | — | Called when a persistence read, deserialization, write, or remove operation throws/rejects. The hook also exposes the latest error as `useChorusPersistence().error`. |
| `serializeMessages` | `(messages: Message<TMeta>[]) => string` | `JSON.stringify` | Optional persistence serializer. Use it for custom formats or to reject unsupported data explicitly. |
| `deserializeMessages` | `(raw: string) => Message<TMeta>[]` | JSON parse + array guard | Optional persistence deserializer/reviver. Use it to validate stored payloads or revive Dates/classes. |
| `showClearButton` | `boolean` | `false` | Shows a built-in clear/reset conversation button above the input. |
| `clearLabel` | `string` | `'Clear conversation'` | Label for the built-in clear/reset button. |
| `confirmClearConversation` | `({ messages, resetToInitialMessages, source, persistenceKey? }) => boolean \| void \| Promise<boolean \| void>` | — | Optional gate for the built-in clear/reset action. Return or resolve `false` to cancel before persistence is flushed. While an async confirmation is pending the clear button is disabled and duplicate clears (button or `ref.clear()`) are ignored. |
| `onClear` | `(messages: Message<TMeta>[]) => void` | — | Called with the reset message list after the built-in clear action runs. |
| `resetToInitialMessages` | `boolean` | `false` | When clearing, restore the initial `messages`/`initialMessages` seed instead of saving an empty transcript. Restores the mount-time seed (frozen-seed contract) even if the seed prop was swapped after mount. |
| `showJumpToBottomButton` | `boolean` | `!headless` | Shows the floating “Jump to latest” button when the user scrolls away from the bottom and new activity arrives. Pass `false` to disable it (for example when you own the scroll affordance); the headless exports default `headless={true}` so the button is off by default there. |
| `showTimestamps` | `boolean` | `false` | Render a locale-aware per-message time under each bubble, sourced from `Message.createdAt`. Messages without a `createdAt` render no time. No custom `renderMessage` is needed. |
| `formatTimestamp` | `(timestamp: string, message: Message<TMeta>) => ReactNode` | short locale-aware time | Overrides the built-in timestamp formatting used when `showTimestamps` is enabled. Receives the message's `createdAt` string and the message; return any node (for example a relative time, or date + time). |
| `headless` | `boolean` | `false` | Strip all default styles and inline style injection. |
| `renderMessage` | `(message: Message<TMeta>, ctx: RenderMessageContext<TMeta>) => ReactNode` | — | Custom per-message renderer. Return `null` to fall back to default rendering. `ctx` includes `isStreaming`, `isEditing` (true while the built-in inline editor is active — gate your own content on it so the editor replaces the row), `messageProps` for scroll targets, `defaultRender(slots?)`, and action callbacks/default action controls. Existing one-argument renderers continue to work. |
| `markdownProps` | `Omit<MarkdownProps, 'text' \| 'codeTheme' \| 'headless' \| 'streaming'>` | — | Props forwarded to the built-in Markdown renderer for every message, including `sanitizer`, `markedOptions`, `markedExtensions`, `onCopyError`, and `codeBlockCopy`. |
| `markdownSanitizer` | `MarkdownSanitizer` | — | Convenience alias for `markdownProps.sanitizer`; takes precedence when both are provided. |
| `hiddenRoles` | `Role[]` | `['system']` | Message roles hidden from the transcript. Tool calls are visible by default in `<Chorus>`; pass `['system', 'tool']` to hide them, or `[]` to show all roles. `<Chorus>` accepts `hiddenRoles` only — `showSystemMessages` exists on `<ChatWindow>` for backwards compatibility. |
| `labels` | `ChorusLabels` | English defaults | Localized strings for every built-in UI surface: composer placeholder/aria-labels/attach/drop-to-attach/send/stop, transcript aria-label/typing/retry/dismiss-error/jump-to-latest/empty-state title, message actions (edit/regenerate/copy/feedback/delete), per-role speaker SR labels, tool-call section headers, reasoning summary, code-fence copy chrome, conversation-list affordances, and the clear button. See [Localizing built-in strings](#localizing-built-in-strings). |

### Localizing built-in strings

Every built-in label defaults to English; pass `labels` to localize or rebrand without replacing components. The same `ChorusLabels` shape is accepted by `<Chorus>` and `<ChatWindow>`; the relevant slice is accepted by `<ChatInput labels={…}>`, `<ConversationList labels={…}>`, `<ToolCallBlock labels={…}>`, and the standalone `<Markdown codeCopyLabels={…} />`. Existing label-shaped props (`placeholder`, `clearLabel`, `newConversationLabel`, `emptyLabel`, `disabledReason`, `errorMessage`) keep precedence so adding `labels` is non-breaking.

```tsx
import { Chorus, type ChorusLabels } from 'react-chorus';

const fr: ChorusLabels = {
  composer: {
    placeholder: 'Écrivez un message',
    ariaLabel: 'Champ de message',
    attachFile: 'Joindre un fichier',
    dropToAttach: 'Déposer pour joindre',
    send: 'Envoyer',
    stop: 'Arrêter',
    disabledReason: 'Composer désactivé.',
    readOnlyReason: 'Composer en lecture seule.',
  },
  transcript: {
    ariaLabel: 'Historique de chat',
    typing: "L'assistant écrit",
    retry: 'Réessayer',
    dismissError: "Masquer l'erreur",
    jumpToLatest: '↓ Aller au plus récent',
    suggestedPromptsAriaLabel: 'Suggestions',
    emptyStateTitle: 'Comment puis-je aider ?',
  },
  messageActions: {
    edit: 'Modifier',
    regenerate: 'Régénérer',
    copy: 'Copier',
    copyFailed: 'Échec de la copie',
    thumbsUp: "J'aime",
    thumbsDown: "Je n'aime pas",
    delete: 'Supprimer',
    save: 'Enregistrer',
    cancel: 'Annuler',
    editTextareaAriaLabel: 'Modifier le message',
  },
  speakers: {
    user: 'Message utilisateur',
    assistant: "Message de l'assistant",
    system: 'Message système',
    tool: 'Message outil',
  },
  toolCall: { input: 'Entrée', output: 'Sortie', running: 'En cours…', empty: 'Aucune sortie' },
  sources: { sources: 'Sources', source: index => `Source ${index + 1}` },
  reasoning: 'Raisonnement',
  codeCopy: { copy: 'Copier', copied: 'Copié !', failed: 'Échec', ariaLabel: 'Copier le code' },
  conversationList: {
    newConversation: 'Nouvelle conversation',
    empty: 'Aucune conversation',
    pin: 'Épingler',
    unpin: 'Désépingler',
    rename: 'Renommer',
    delete: 'Supprimer',
    save: 'Enregistrer',
    cancel: 'Annuler',
    navAriaLabel: 'Conversations',
    renameAriaLabel: title => `Renommer ${title}`,
    pinAriaLabel: (title, pinned) => `${pinned ? 'Désépingler' : 'Épingler'} ${title}`,
    deleteAriaLabel: title => `Supprimer ${title}`,
  },
  attachments: {
    readingStatus: name => `Lecture de ${name}`,
    uploadingStatus: name => `Envoi de ${name}`,
    completedAnnouncement: name => `${name} prêt`,
    failedAnnouncement: name => `Échec : ${name}`,
    removeAttachment: name => `Retirer ${name}`,
    dismissError: "Fermer l'erreur",
    describeImage: 'Décrire cette image',
    describeImageInputAriaLabel: name => `Description de ${name}`,
    describeImagePlaceholder: 'Décrivez cette image',
    imageFallbackAlt: name => `Image jointe : ${name}`,
    unsupportedTypeError: ({ name, accept }) =>
      `${name} n'est pas accepté${accept ? ` (${accept})` : ''}.`,
    tooLargeError: ({ name, size, limit }) => `${name} (${size}) dépasse la limite ${limit}.`,
    tooManyError: ({ name, max }) => `Limite ${max} pour ${name}.`,
    readFailedError: ({ name, detail }) => `Lecture impossible de ${name} : ${detail}`,
    uploadFailedError: ({ name, detail }) => `Envoi impossible de ${name} : ${detail}`,
  },
  clearConversation: 'Effacer la conversation',
};

<Chorus transport="/api/chat" labels={fr} />;
```

Labels are deep-merged with the defaults, so you only need to override the strings you actually want to change. **Partial overrides only:** `undefined`, `null`, and empty-string values fall back to the English default so a loose i18n catalog cannot accidentally erase a UI label. Pass a non-empty whitespace string (e.g. `' '`) when you genuinely want a visually empty value. `resolveChorusLabels(partial)` is exported when you want to compute the resolved set yourself (for storybook fixtures, `<ChatWindow>` outside of `<Chorus>`, or fully custom shells).

The `attachments` slice localizes the attachment composer end-to-end: chip remove-button labels, the pending read/upload polite-live status text and `aria-busy` chips, the polite-live completion announcements that confirm "attached" / "failed" after a pending chip resolves, the dismiss-error button, the "describe this image" affordance (visible next to image chips so users can supply alt text before sending), validation/read/upload error messages with `{name, accept, size, limit, max, detail}` interpolation, and the role-hinted image fallback alt rendered in the transcript when `Attachment.alt` is absent. The English defaults for just this slice are exported as `DEFAULT_ATTACHMENT_LABELS` (a `ChorusAttachmentLabels`), handy when you want to extend the attachment strings rather than replace them.

The `sources` slice localizes the built-in source/citation footer (`Sources`) and fallback `Source N` labels used when a source has no title, URL, or id. Streamed provider citations are stored as `message.sources` and rendered from that same footer.

### `helpers` (passed to `onSend`)

| Helper | Description |
|--------|-------------|
| `appendAssistant(chunk)` | Append a text chunk to the current assistant message. Chunks are buffered until `minAssistantDelayMs` has elapsed before the first token is shown. |
| `appendReasoning(chunk)` | Append a reasoning/thinking chunk to the current assistant message. |
| `appendSource(source)` | Attach a source/citation to the current assistant message's `sources` array. Use this for custom RAG clients that stream citations outside a built-in connector. |
| `appendToolDelta(delta)` | Create/update a `role: 'tool'` row from an accumulated connector tool delta. **Presentation only** — it does not execute registered `tools` handlers, fire `onToolCall`/`onToolDelta`, or drive the auto-continue loop, so `toolCall.output` stays unset. On the `onSend` path you run the tool yourself, then call `appendToolDelta` again with the same `delta.id` and an `output` to fill the row and `appendAssistant` for the follow-up turn. |
| `streamCallbacks()` | Convenience helper returning `{ onChunk, onReasoning, onSource, onToolDelta, onWarning, onMetadata, onDone, onError }` for `useChorusStream(...).send()`. `onSource` attaches streamed citations to the assistant message, `onWarning` forwards non-fatal connector warnings to the `<Chorus onStreamWarning>` prop, and `onMetadata` forwards free-form provider metadata to the `<Chorus onStreamMetadata>` prop. `onError` surfaces a mid-stream failure (the error banner + the `onError` prop) and drops the half-streamed partial even if your `onSend` does not return or await the `send()` promise. `minAssistantDelayMs` is applied by Chorus on this path, so do not also pass `minDelayMs` to `send()` — the two first-token delays would stack. It is present at runtime; optional chaining keeps older hand-written helper mocks type-compatible. |
| `finalizeAssistant()` | Mark the assistant message complete. If first-token chunks are still buffered, completion waits until they flush. |
| `signal` | `AbortSignal` — aborted when Stop, clear-while-sending, or a superseding session cancels the active send. |
| `systemPrompt` | The optional `systemPrompt` prop. Use it when serializing custom `onSend` requests; Chorus does not insert it into the `messages` argument on this path. |

Call `finalizeAssistant()` when your custom stream is done. In development, Chorus warns if `onSend` appended chunks and then resolved without finalizing; it will still flush those chunks and reset the sending state so the UI cannot get stuck in Stop mode.

### Keyboard shortcuts

- Composer textarea: **Enter** sends, **Shift+Enter** inserts a newline.
- Inline edit textarea: **Enter** saves, **Shift+Enter** inserts a newline, and **Escape** cancels editing. Enter is ignored while an IME candidate is being composed, and Escape stops propagating so cancelling an edit inside a modal/drawer does not also close the ancestor.

### Imperative `ChorusRef`

Use a ref for suggested prompts, global focus shortcuts, external clear buttons, or scrolling to a known message:

```tsx
import React from 'react';
import { Chorus, type ChorusRef } from 'react-chorus';

export function SupportChat() {
  const chorusRef = React.useRef<ChorusRef>(null);
  const suggestions = ['Summarize my account', 'Explain my last invoice'];
  const exportTranscript = () => {
    const blob = new Blob([JSON.stringify(chorusRef.current?.getMessages() ?? [], null, 2)], {
      type: 'application/json',
    });
    window.open(URL.createObjectURL(blob), '_blank');
  };

  return (
    <>
      {suggestions.map((text) => (
        <button key={text} type="button" onClick={() => chorusRef.current?.send(text)}>
          {text}
        </button>
      ))}
      <button type="button" onClick={() => chorusRef.current?.focus()}>Focus chat</button>
      <button type="button" onClick={exportTranscript}>
        Export transcript
      </button>
      <Chorus ref={chorusRef} transport="/api/chat" />
    </>
  );
}
```

The ref exposes `send(text, attachments?)`, `stop()`, `clear()`, `retry()`, `regenerate(messageId)`, `dismissError()`, `focus()`, `getMessages()`, and `scrollToMessage(id)`.

```ts
interface ChorusRef<TMeta = Record<string, unknown>> {
  send(text: string, attachments?: Attachment[]): boolean;
  stop(): void;
  clear(): boolean;
  retry(): boolean;
  regenerate(messageId: string): boolean;
  dismissError(): boolean;
  focus(): void;
  getMessages(): Message<TMeta>[];
  scrollToMessage(id: string): boolean;
}
```

`send()` returns `true` when Chorus accepted the message and started a turn, and `false` when the send was rejected — nothing was appended to the transcript and no transport/onSend call was made. Rejection cases:

- `<Chorus disabled>`, `<Chorus readOnly>`, or an async built-in persistence load is pending.
- Controlled mode (`value` provided) with no `onChange` prop, so the new message could not be reflected.
- A send or tool-loop turn is already in flight.
- The text is empty and no attachments were supplied.
- Neither `transport` nor `onSend` is configured.

`clear()` returns `true` when the clear path was kicked off and `false` when rejected. Rejection cases:

- `<Chorus disabled>`, `<Chorus readOnly>`, or an async built-in persistence load is pending.
- A previous `confirmClearConversation` promise is still pending.
- Controlled mode (`value` provided) with no `onChange` prop.

When `confirmClearConversation` is configured, `true` means the confirmation flow was started — the actual reset still depends on the callback resolving to anything other than `false`.

On an accepted send, `send()` also resets the composer the same way a UI-driven send does — the draft text is cleared, the textarea collapses to a single line, and any attachment chips the user had staged are discarded. (`send()` sends its own explicit `attachments` argument; staged chips are never sent by an imperative call.) An accepted `clear()` resets the composer the same way.

`retry()`, `regenerate(messageId)`, and `dismissError()` are the imperative equivalents of the built-in error-banner Retry / message-toolbar Regenerate / banner-dismiss controls, so a fully custom chat shell can drive them without simulating clicks on chrome it has hidden:

- `retry()` re-runs the last assistant turn after a stream error. It returns `false` when there is no current error to retry.
- `regenerate(messageId)` regenerates a specific assistant message, replaying from the user turn that preceded it. It returns `false` when `messageId` does not match a message or no user message precedes it.
- `dismissError()` clears the current stream error state. It returns `false` when there is no error to dismiss.

`retry()` and `regenerate(messageId)` also return `false` for the shared rejection cases — `<Chorus disabled>`, `<Chorus readOnly>`, an async built-in persistence load still pending, or controlled mode (`value` provided) with no `onChange` prop. `dismissError()` is **not** gated by `disabled`/`readOnly`/persistence-loading: clearing a stream error mutates transient state, not the transcript, so — like the built-in error banner's dismiss button — it stays available in those modes. (It is still rejected in controlled mode with no `onChange`.)

`scrollToMessage(id)` returns `true` when it finds a rendered message row and `false` otherwise. A `false` is ambiguous between an id that matches no message and a valid message whose row is not currently in the DOM — windowed out by `maxRenderedMessages`, hidden by `hiddenRoles`, or drawn by a custom `renderMessage` that returns a fragment/custom component without spreading `ctx.messageProps`. To tell the two apart, cross-check the id against `getMessages()`: a `false` for an id `getMessages()` includes is the valid-but-unrendered case (a development-only one-time warning also flags it). Notably a "jump to message"/citation target older than the `maxRenderedMessages` window cannot be scrolled to until enough older rows render. `stop()` always remains available for active responses.

### Disabled and read-only states

Use `disabled` when the user cannot currently compose (for example no active conversation or a missing API key), and `readOnly` when the transcript should remain browsable but immutable (for example an archived conversation):

```tsx
<Chorus
  transport={apiKey ? '/api/chat' : undefined}
  disabled={!activeConversationId || !apiKey}
  disabledReason={!activeConversationId ? 'Select a conversation first' : !apiKey ? 'Add an API key to chat' : undefined}
/>

<Chorus
  transport="/api/chat"
  readOnly={conversation.archived}
  disabledReason={conversation.archived ? 'This conversation is archived' : undefined}
/>
```

Disabled and read-only modes block Enter/click sends, file picker/paste/drop attachment work, suggested-prompt fills, retry/clear, and write message actions (edit/regenerate/delete/feedback). Copying messages, scrolling, and the Stop button for an active response remain available.

### Clearing/resetting a conversation

Use the built-in clear button for uncontrolled or persisted chats:

```tsx
<Chorus
  persistenceKey="support-chat"
  initialMessages={[{ id: 'welcome', role: 'assistant', text: 'Hi! How can I help?' }]}
  showClearButton
  onPersistenceError={(err) => reportError(err)}
/>
```

By default, clearing writes an empty conversation. If the chat was seeded with `initialMessages`/legacy `messages`, Chorus persists `[]` even when the adapter supports `removeItem`; that explicit empty transcript prevents welcome messages from resurrecting on reload. If there is no seed, a `removeItem`-capable adapter may delete the key, while adapters without `removeItem` fall back to saving `[]`. Pass `resetToInitialMessages` to restore and persist the seed welcome messages instead. In controlled mode, the same button calls `onChange(resetMessages)` and `onClear(resetMessages)`; keep the canonical list in your state as usual.

Wire `confirmClearConversation` to gate the destructive action — the callback receives `{ messages, resetToInitialMessages, source, persistenceKey? }` and persistence is flushed only after it returns/resolves anything except `false`. While an async confirmation is pending, the clear button is disabled and duplicate clicks (or `ref.clear()` calls) are ignored.

```tsx
<Chorus
  persistenceKey="support-chat"
  showClearButton
  confirmClearConversation={async ({ messages }) => {
    if (!messages.length) return true;
    return window.confirm('Clear this saved conversation? This cannot be undone.');
  }}
/>
```

A storage adapter can be synchronous (like `localStorage`) or Promise-based:

```ts
interface StorageAdapter {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem?(key: string): void | Promise<void>;
}
```

For multiple saved chats, use `useConversations` with `ConversationList` and pass the active persistence key/storage into Chorus. The list renders pinned conversations first, formats timestamps for display while keeping ISO `dateTime` attributes, disables conversation mutations while `conversations.loaded === false`, and exposes pin/rename/delete affordances when you pass the corresponding hook actions:

```tsx
const conversations = useConversations({ defaultTitle: 'New chat' });

<ConversationList {...conversations} />
<Chorus
  persistenceKey={conversations.activePersistenceKey}
  persistenceStorage={conversations.storage ?? undefined}
  disabled={!conversations.loaded || !conversations.activeId}
  disabledReason={!conversations.loaded ? 'Loading conversations…' : !conversations.activeId ? 'Create or select a conversation first.' : undefined}
  onMessagesChange={(messages) => {
    if (conversations.activeId) conversations.renameFromFirstMessage(conversations.activeId, messages);
  }}
/>
```

`useConversations({ indexKey, messageKeyPrefix, storage, onError })` stores a JSON index of `{ id, title, createdAt, updatedAt, pinned, pristine }` records under `indexKey` (default `chorus-conversations-index`) and stores each transcript under `${messageKeyPrefix}${id}`. `pristine` tracks whether `renameFromFirstMessage()` may still auto-title the conversation; explicit renames and successful auto-renames clear it. Selecting a conversation bumps `updatedAt` so recency-sorted lists promote recently visited chats. `deleteConversation(id)` removes the transcript key via `removeItem` when available (or writes `[]` without it). To gate the built-in sidebar delete affordance, pass `confirmDeleteConversation={({ conversation }) => window.confirm('Delete ' + conversation.title + '?')}` to `ConversationList`; returning or resolving `false` cancels before `deleteConversation` updates storage. Index read/write and transcript delete failures surface through `result.error` and `onError(error)` with `error.key`, `error.operation` (`'read' | 'write' | 'delete'`), and `error.conversationId` for transcript deletes. With async storage, `createConversation()` calls made before `loaded` resolves are queued and merged into the loaded index; custom sidebars should still disable New/Rename/Delete controls while `loaded` is false to avoid surprising delayed mutations.

When the default `localStorage` adapter is used, both `useConversations` and `useChorusPersistence` listen for the browser's `storage` event so writes from another tab (a new conversation, a streamed reply, a deletion) are picked up automatically. Cross-tab sync is intentionally limited to the default adapter — if you pass a custom `StorageAdapter` (sessionStorage, IndexedDB, a remote API, etc.), the hooks do not subscribe to `storage` events and that adapter is responsible for its own change notification.

#### `useConversations` storage lifecycle

- **`loaded` transition.** `loaded` is `true` synchronously when the storage adapter returns the index synchronously (e.g. `localStorage`) and `false` while an async `getItem(indexKey)` is still resolving. While `loaded === false`, `conversations` is `[]` and `activeId` is `null`; render a skeleton/spinner instead of the empty state, and disable sidebar New/Rename/Delete controls. Once the index resolves, `loaded` flips to `true` once and stays true for the lifetime of the hook.
- **Pre-load mutations.** `createConversation()` calls made while `loaded === false` are queued and merged into the loaded index after the async read resolves; the returned id is stable so you can navigate immediately. Other mutations (`selectConversation`, `renameConversation`, `renameFromFirstMessage`, `pinConversation`, `deleteConversation`) are ignored while `loaded === false` to avoid clobbering an in-flight index.
- **Error routing.** Adapter failures surface as a `ConversationStorageError` on `result.error` and through `onError(error)`. Reads/writes never throw a promise out of the hook. Each error carries `error.key`, `error.operation` (`'read' | 'write' | 'delete'`), and `error.conversationId` (for transcript deletes), plus `error.cause` with the original adapter error. Per-message persistence failures from the active conversation's transcript flow through `<Chorus onPersistenceError>` instead (the wrapping storage adapter only touches index timestamps).
- **Write ordering.** Index writes triggered by user actions (create/rename/pin/delete/select) are flushed immediately; `touchConversation` bumps `updatedAt` and is debounced ~300 ms so rapid activity does not thrash storage. Selecting a conversation changes only the active ID — it never modifies any conversation's `updatedAt`, so recency-sorted lists stay stable when you merely open a conversation. Writes are serialized per-hook: a pending write waits for the previous one to resolve before issuing the next, so concurrent create/delete is safe and the final index always reflects the last action.
- **`onError` reentry.** `onError` is called synchronously after `result.error` is updated. It is safe to call the hook's actions from inside `onError`, but avoid throwing — a thrown handler is warned in development and ignored.

### Persistence examples

The basic runnable example enables `persistenceKey`, so it saves to `localStorage` by default. To combine `persistenceKey` with a server-loaded transcript (Next.js `page.tsx` / `getServerSideProps` / Remix `loader` seeded into `initialMessages`), see the [Server-side history pre-load](guide.md#server-side-history-pre-load) recipe — it covers the precedence rule when both seeds are present and the `useId` pattern for fresh conversations. You can swap storage adapters without changing the rest of the chat:

```tsx
// localStorage (default)
<Chorus persistenceKey="support-chat" transport="/api/chat" />

// sessionStorage
<Chorus persistenceKey="support-chat" persistenceStorage={sessionStorage} transport="/api/chat" />

// Async adapter (IndexedDB, remote draft API, etc.)
const asyncStorage = {
  async getItem(key: string) {
    return await draftsApi.load(key);
  },
  async setItem(key: string, value: string) {
    await draftsApi.save(key, value);
  },
};

<Chorus
  persistenceKey="support-chat"
  persistenceStorage={asyncStorage}
  onPersistenceError={(error) => reportError(error)}
  transport="/api/chat"
/>
```

The built-in `<Chorus persistenceKey>` path disables its composer with the placeholder “Loading saved conversation…” until an async `getItem()` finishes. If you build a custom shell around the exported hooks, use each hook's `loaded` boolean the same way (for example `disabled={!persist.loaded}` or `disabled={!conversations.loaded}`) unless you explicitly merge queued edits yourself.

### Observing streamed tokens with `onChunk`

`onChunk` fires once per streamed token on both the `transport` and `onSend` paths. It's a pure observation hook — it does not interfere with rendering — so it's the right place for live token counting, analytics, or mirroring the stream into an external store:

```tsx
const tokensRef = React.useRef(0);

<Chorus
  transport="/api/chat"
  onChunk={(chunk, messageId) => {
    tokensRef.current += 1;
    // Mirror into an external store keyed by the assistant messageId.
    store.append(messageId, chunk);
  }}
/>
```

`chunk` is the **incremental** text delta the connector just produced — typically one SSE token, never the running accumulated transcript. Append `chunk` yourself (keyed by `messageId`) if you need the full running text. The delta is the raw connector text **before** Markdown parsing/highlighting — `onChunk` does not see sanitized HTML, code-block chrome, or any rendering side effects.

`onChunk` is called only for assistant `text` deltas; reasoning deltas, tool-call deltas, and provider error frames do not trigger it. Final-turn telemetry is reported separately via `onFinish` (successful completion with an assistant message), `onStreamDone` (every stream end, including tool-only turns), `onAbort` (Stop/clear/superseded), and `onError`.

When you drive `useChorusStream` directly, callbacks fire in this order for a single send:

1. `onStart(firstChunk)` — fires once on the first delivered event of any kind (text, reasoning, or tool-call delta), so reasoning-first and tool-only turns still get the signal. `firstChunk` carries the first text chunk when that event is text (also delivered to `onChunk`); otherwise it is an empty string.
2. `onChunk(chunk)` — fires for every non-empty text chunk in stream order.
3. `onDone(response?)` or `onError(error)` — exactly one of these after the stream finalizes (an aborted send rejects without calling `onError`).

`onReasoning` and `onToolDelta` interleave with `onChunk` independently. If `minDelayMs`/`minAssistantDelayMs` is non-zero, chunks are buffered until the delay elapses, then flushed in stream order before any are delivered.

`onWarning` fires for non-fatal connector warnings (`{ code, message, payload? }`) as the connector emits them — e.g. a `truncated` warning when the model stopped at its max-token limit, or safety-rating notices. Unlike `onError`, a warning does not abort the stream: `onDone` still fires afterwards. A throwing `onWarning` is warned in development and otherwise ignored, so a misbehaving warning observer cannot fail an otherwise-successful send. When you drive `useChorusStream` directly and omit `onWarning`, warnings are logged once in development so the signal stays discoverable; `<Chorus>` surfaces them through the `onStreamWarning` prop.

`onMetadata` fires for free-form provider metadata (`Record<string, unknown>`) as connectors emit it — OpenAI Responses token `usage`, Anthropic `stopReason`/`stopSequence`, Gemini `safetyRatings`/`finishReason`, OpenAI Chat `finishReason`. Like `onWarning` it never aborts the stream and a throwing handler is warned in development and otherwise ignored. Unlike `onWarning`, omitting it drops metadata silently — it is opt-in diagnostics, not a signal a developer needs surfaced — so directly-driven hooks see no dev log. `<Chorus>` surfaces it through the `onStreamMetadata` prop; wire it for usage/cost telemetry such as a live budget meter.

### Completion telemetry with `onFinish`

Use `onFinish` when you need the final assistant message rather than token-by-token observations:

```tsx
<Chorus
  transport="/api/chat"
  onFinish={({ message, messages, reason, response }) => {
    analytics.track('assistant_completed', {
      assistantMessageId: message.id,
      characters: message.text.length,
      turns: messages.filter((m) => m.role === 'user').length,
      reason,
      status: response?.status,
    });
  }}
/>
```

`onFinish` is not called for Stop/abort, transport errors, provider error payloads, tool-only streams, or other sends that produce no assistant message. Use `onAbort` for cancellation telemetry, and `onStreamDone` or `onToolCall` when you need completion telemetry for tool-only turns.

### Abort telemetry with `onAbort`

Use `onAbort` when you need to persist or measure cancelled generations:

```tsx
<Chorus
  transport="/api/chat"
  onAbort={({ message, messages, reason, source, path }) => {
    analytics.track('assistant_aborted', {
      assistantMessageId: message?.id,
      partialCharacters: message?.text.length ?? 0,
      turns: messages.filter((m) => m.role === 'user').length,
      reason, // 'stop' | 'clear' | 'superseded'
      source, // 'user' | 'programmatic'
      path, // 'transport' | 'onSend'
    });
  }}
/>
```

Built-in Stop reports `reason: 'stop'` and `source: 'user'`; `ref.stop()` reports `reason: 'stop'` and `source: 'programmatic'`. Clearing while sending reports `reason: 'clear'` before the transcript is reset, so `messages` can still include the partial assistant. Built-in send/edit/regenerate/retry actions do not start a second generation while one is active; if an integration supersedes an active session, Chorus reports `reason: 'superseded'` and `source: 'programmatic'`.

### Transcript observer and export

Use `onMessagesChange` when you want a drop-in `<Chorus>` but still need audit logging, analytics, live stats, or transcript export. Unlike `onChange`, it fires in every message-source mode and does not make the component controlled:

```tsx
const latestMessages = React.useRef<Message[]>([]);

<Chorus
  persistenceKey="support-chat"
  transport="/api/chat"
  onMessagesChange={(messages, context) => {
    latestMessages.current = messages;
    auditLog.enqueue({ source: context.source, reason: context.reason, messages });
  }}
/>

<button type="button" onClick={() => downloadTranscript(latestMessages.current)}>
  Download transcript
</button>
```

For one-off reads from outside React state, call `chorusRef.current?.getMessages()`.

### Transcript search, copy, and export

`useChorusTranscriptActions` is a headless utility hook for building a search box, a "copy conversation" button, or a "download transcript" affordance around `<Chorus>` or a custom headless shell — without writing the indexing, clipboard, and serialization layers yourself. Pass it the same `messages` array you render (from `chorusRef.getMessages()`, `onMessagesChange`, or your own state) and it returns four callbacks with stable identities:

- `searchMessages(query)` — case-insensitive substring search across each message's `text`, each attachment's file `name`, each source/citation's title/url/snippet, the `reasoning` of assistant messages, and — for tool messages — `toolCall.name` plus its serialized `input` and `output`. These are exactly the values `exportAs('markdown')` renders, so a string visible in the export is findable here and vice versa. Returns the matching `Message[]`; a blank/whitespace-only query returns `[]`. Pair it with `chorusRef.scrollToMessage(id)` to jump to a hit.
- `copyAll(format?)` — copies the whole transcript to the clipboard. Defaults to `'markdown'`; pass `'json'` for the raw structure. Resolves `false` without touching the clipboard when the transcript is empty (a non-error signal — `onCopyError` is not called — so you can disable the button). Also resolves `false`, and calls the optional `onCopyError`, when the Clipboard API is unavailable or the write rejects.
- `exportAs(format)` — serializes the transcript to a string. `'markdown'` renders a readable transcript with one heading per message (assistant messages include `**Reasoning:**` and `**Sources:**` blocks when present; tool calls include their input/output); `'json'` returns `JSON.stringify(messages, null, 2)`, which round-trips through `JSON.parse` including `sources` and metadata.
- `downloadAs(format, filename?)` — serializes the transcript and saves it to a file by triggering a transient `<a download>`, so you skip the `Blob`/`createObjectURL`/anchor/`revokeObjectURL` dance. `filename` defaults to `transcript.md` / `transcript.json` per format (a name with no extension gets the format's appended); the MIME type is picked for you. Returns `false` without downloading when the transcript is empty or no DOM is available (e.g. SSR), and `true` once the download starts. The `TRANSCRIPT_FORMAT_INFO` record (`{ markdown, json }` → `{ mimeType, extension }`) is exported too if you need those values for your own download or upload code.

```tsx
import React from 'react';
import { Chorus, useChorusTranscriptActions, type ChorusRef, type Message } from 'react-chorus';

export function SearchableChat() {
  const chorusRef = React.useRef<ChorusRef>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const { searchMessages, copyAll, downloadAs } = useChorusTranscriptActions(messages);

  const jumpToFirstHit = (query: string) => {
    const [hit] = searchMessages(query);
    if (hit) chorusRef.current?.scrollToMessage(hit.id);
  };

  return (
    <>
      <input type="search" placeholder="Search transcript…" onChange={(e) => jumpToFirstHit(e.target.value)} />
      <button type="button" onClick={() => copyAll()}>Copy conversation</button>
      <button type="button" onClick={() => downloadAs('markdown')}>Download .md</button>
      <Chorus ref={chorusRef} transport="/api/chat" onMessagesChange={setMessages} />
    </>
  );
}
```

`useChorusTranscriptActions` is also re-exported from `react-chorus/headless`. Pass `{ roleLabels }` to relabel the Markdown headings (for example `{ user: 'Customer', assistant: 'Agent' }`) and `{ onCopyError }` to observe clipboard failures from `copyAll()`.

### Attachment composer UX

Passing `accept` enables the built-in attachment composer. Users can pick files, paste files from the clipboard, or drag/drop files anywhere over the chat surface — the transcript as well as the composer — and a "Drop to attach" overlay confirms the drop target while a file is dragged over it. All paths use the same `accept` matching (`image/*`, exact MIME types, and extensions such as `.pdf`). An empty or whitespace-only `accept` (and `maxAttachmentBytes={0}`) means "no attachments allowed": the attach button is hidden and stray drops are still neutralized so the browser never navigates away to a dropped file's URL.

By default, react-chorus reads accepted files into base64 **data URLs** and stores them in `Message.attachments`. That makes local demos and simple persistence easy, but data URLs can inflate request bodies and persisted history. For production, set size/count limits and consider `uploadAttachment` so large files are uploaded to your storage/provider before the message is sent.

Limit file size/count and surface actionable errors:

```tsx
<Chorus
  transport="/api/chat"
  accept="image/*"
  maxAttachmentBytes={2 * 1024 * 1024}
  maxAttachments={3}
  onAttachmentError={(error) => {
    // error.reason: 'unsupported-type' | 'too-large' | 'too-many' | 'read-failed' | 'upload-failed'
    toast.error(error.message);
  }}
/>
```

Upload/transform files before they enter message history:

```tsx
<Chorus
  transport="/api/chat"
  accept="image/*,.pdf"
  uploadAttachment={async (file, { signal } = {}) => {
    const form = new FormData();
    form.set('file', file);
    const uploaded = await fetch('/api/uploads', { method: 'POST', body: form, signal }).then(r => r.json());

    return {
      name: file.name,
      type: file.type,
      size: file.size,
      url: uploaded.url,      // used for previews when renderable
      id: uploaded.fileId,    // preserve provider/storage ids for your backend
      data: uploaded.url,     // optional; defaults to url or id when omitted
    };
  }}
/>
```

If you return only `url` or `id`, Chorus normalizes `attachment.data` to that value for backwards compatibility. Your backend should still prefer explicit `url`/`id` fields when present.

For a complete runnable flow — a real `/api/uploads` endpoint, large-PDF handling, and mapping the returned id/url into an OpenAI, Anthropic, or Gemini request — see the [out-of-band attachment uploads recipe](uploads.md).

All accepted files first appear as pending attachment chips while they are read as data URLs or processed by `uploadAttachment`, and Send is disabled until every pending chip resolves. Removing a pending chip aborts its `AbortSignal`; late FileReader/upload completions are ignored and do not re-add the file. Read failures call `onAttachmentError` with `reason: 'read-failed'`; upload failures call `reason: 'upload-failed'`; user-initiated aborts are silent.

**Accessibility:** pending chips set `aria-busy="true"` and expose a polite live-region "Reading/Uploading {name}" status so screen-reader users hear the upload in progress. When a pending attachment completes, the composer emits a separate polite live-region "{name} attached" announcement so success is heard even though the spinner has been removed. A read/upload failure is announced exactly once — by the polite attachment error region (`role="status"`, `aria-live="polite"`) when it is rendered, or, when that region is suppressed with `renderAttachmentError={null}`, by the polite announcer span ("{name} failed to attach"). All of these strings flow through `labels.attachments` for localization.

**Image alt text.** `Attachment.alt` is an optional human-authored description used as the image `alt` when the message renders in the transcript. When `alt` is omitted, the renderer falls back to a role-hinted label (`Attached image: {name}` by default, localizable via `labels.attachments.imageFallbackAlt`) rather than the bare filename. Image attachment chips in the composer expose an inline "Describe this image" affordance that captures alt text before send; the typed value flows into the `Attachment.alt` passed to `onSend`. Custom upload flows can also set `alt` themselves before returning the attachment from `uploadAttachment`.

### Sources and citations

Assistant messages can carry structured source/citation references in `message.sources`. Each entry is a `MessageSource`:

#### `MessageSource`

```ts
type MessageSourceType = 'url' | 'document' | 'file' | 'unknown';

interface MessageSource {
  id?: string;
  type?: MessageSourceType;
  title?: string;
  url?: string;
  snippet?: string;
  metadata?: Record<string, unknown>;
}

// Alias preserved because sources are usually shown to readers as citations.
type MessageCitation = MessageSource;
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Stable identifier used to deduplicate streamed source frames via [`appendMessageSource`](#sources-and-citations). When the provider does not emit one, built-in connectors derive a stable id from the URL or a location-based key (e.g. `documentTitle#documentIndex`, `gemini-grounding-${chunkIndex}`); for arbitrary string ids the default UI falls back through `title || url || id || fallback` (see below). |
| `type` | `'url' \| 'document' \| 'file' \| 'unknown'` | Broad source family. The default renderer treats `url` as a link target, `document`/`file` as inline labels, and `unknown` as a passthrough. Custom shells can use it to choose an icon or section. |
| `title` | `string` | Human-readable label — page title, file name, or document heading. **Rendered as plain text** by the default `MessageSources` UI (no Markdown parsing, no HTML sanitization), so it can hold any user-facing string without escaping. |
| `url` | `string` | Canonical URL the source can be opened at. When present, the default UI renders the source as a hyperlink. |
| `snippet` | `string` | Short quoted excerpt or description (provider citations populate this from `cited_text`, `quote`, or `snippet` fields). **Rendered as plain text** alongside the title — not Markdown, not sanitized HTML. |
| `metadata` | `Record<string, unknown>` | Host-owned free-form details — page numbers, char/page/block offsets, file ids, encrypted result bodies, media types, licenses, etc. Chorus never reads or mutates this field, but it **round-trips through built-in JSON persistence** (`JSON.stringify` / `JSON.parse`), so keep values JSON-serializable (no `Date`, `BigInt`, or class instances) unless you also pass custom `serializeMessages` / `deserializeMessages`. The connectors that emit sources set `metadata.provider` (`'openai'`, `'anthropic'`, `'gemini'`, `'ai-sdk'`) so a custom renderer can branch on the originator. |

`MessageCitation` is exported as an alias for `MessageSource` for back-compat readability; both names refer to the same object shape.

**Display-label priority.** The default `MessageSources` UI labels each entry using `source.title || source.url || source.id || fallback` (where `fallback` is the localized `labels.sources.source(index)` string, e.g. `Source 1`). Custom shells that render their own source list can either import the `sourceDisplayLabel(source, fallback)` helper from `react-chorus` (or `react-chorus/headless`) to match the built-in label exactly, or reimplement the same priority order to stay forward-compatible if Chorus ever adds another renderer slot.

```ts
import { sourceDisplayLabel } from 'react-chorus';

const label = sourceDisplayLabel(source, `Source ${index + 1}`);
```

**Which connectors emit sources today?** All four built-in connectors do — see the [connector source/citation support matrix](guide.md#connector-sourcecitation-support-matrix) in the usage guide for the per-provider fields populated and the underlying SSE events parsed. AI SDK UI-message-stream `source-url` / `source-document` / source-like `message-metadata`, AI SDK data-stream `j:` sources and source-like annotation frames (`7:`/`8:`), OpenAI Responses output-text annotation events, Anthropic `citations_delta` and `web_search_tool_result` content blocks, and Gemini `groundingMetadata.groundingChunks` plus `citationMetadata.citationSources` / `citations` all flow into `message.sources`. These frames never become assistant text — the default renderer shows a `Sources` footer, `renderMessage` receives the same data as `ctx.sources`, per-message Copy includes the source list, and `useChorusTranscriptActions` search/export/copy-all include source title/url/snippet. Built-in JSON persistence stores `sources` with the rest of the message; if you provide custom `serializeMessages` / `deserializeMessages`, keep the array JSON-serializable or revive it yourself.

For custom `onSend` RAG clients, either return an assistant message with `sources` already populated or stream them with `helpers.appendSource({ title, url, snippet })`. If you bridge `useChorusStream`, `helpers.streamCallbacks()` wires `onSource` for you.

### Hiding or showing tool calls

`<Chorus>` uses `hiddenRoles` to control which roles appear in the transcript (`showSystemMessages` is only available on `<ChatWindow>`, for backwards compatibility). By default `<Chorus>` hides system prompts and shows tool call blocks, which is the usual agent-UI pattern:

```tsx
<Chorus
  transport="/api/chat"
  hiddenRoles={['system']} // default: show user, assistant, and tool — hide system prompts
/>
```

Pass `hiddenRoles={['system', 'tool']}` to hide tool calls as well, or `hiddenRoles={[]}` to show every role.

For controlled mode, seed your own state instead of using `initialMessages`, and include hidden system/tool messages directly when you want full control over the request history:

```tsx
const [messages, setMessages] = React.useState<Message[]>([
  { id: 'sys', role: 'system', text: 'You are a concise support assistant.' },
  { id: 'welcome', role: 'assistant', text: 'Hi! How can I help?' },
]);

<Chorus value={messages} onChange={setMessages} transport="/api/chat" />
```

### Showing message timestamps

Every `Message` accepts an optional `createdAt` ISO-8601 string (for example `new Date().toISOString()`). It is informational only — Chorus never sets it for you — and is ignored unless you opt in with `showTimestamps`:

```tsx
<Chorus
  transport="/api/chat"
  showTimestamps
  initialMessages={[
    { id: 'welcome', role: 'assistant', text: 'Hi! How can I help?', createdAt: new Date().toISOString() },
  ]}
/>
```

With `showTimestamps`, the default renderer adds a locale-aware `<time>` element below each bubble; messages without a `createdAt` render no time. The default formatter shows a short time of day (`Intl.DateTimeFormat`, with a `toLocaleTimeString` fallback). Pass `formatTimestamp` for a different format — for example a relative time or a date + time — and it also receives the message so you can vary by role. The prop's type is exported as `MessageTimestampFormatter<TMeta>` for typing a reusable formatter:

```tsx
<Chorus
  transport="/api/chat"
  showTimestamps
  formatTimestamp={(timestamp) => new Date(timestamp).toLocaleString()}
/>
```

No custom `renderMessage` is required. The `Reasoning` disclosure, by contrast, only ever renders for `assistant` messages — a `reasoning` field on a `user`, `system`, or `tool` message is ignored by the default renderer.

### Rendering long transcripts

By default, `<Chorus>` and `<ChatWindow>` render every visible message so browser find, screen-reader history, and custom layouts see the full transcript. For very long persisted chats with heavy Markdown, pass `maxRenderedMessages` to render only the latest N visible messages:

```tsx
<Chorus transport="/api/chat" maxRenderedMessages={100} />
```

This is a simple windowing escape hatch rather than full virtualization: earlier visible messages are not mounted until you remove/increase the limit, but typing/error rows stay accessible, bottom auto-scroll still tracks new output, and edit/regenerate/delete actions continue to target original message IDs.

### Driving Chorus with `useChorusStream` directly

`useChorusStream` is also useful without `<Chorus>` when you want a fully custom transcript shell:

```tsx
import React from 'react';
import { createFetchSSETransport, useChorusStream, type Message } from 'react-chorus';

const transport = createFetchSSETransport('/api/chat');

export function CustomChat() {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const { send, abort, sending } = useChorusStream(transport, { connector: 'openai' });

  async function submit(text: string) {
    const user: Message = { id: crypto.randomUUID(), role: 'user', text };
    const assistant: Message = { id: crypto.randomUUID(), role: 'assistant', text: '' };
    const history = [...messages, user];
    setMessages([...history, assistant]);

    try {
      await send(text, history, {
        onChunk: (chunk) => setMessages((prev) => prev.map((m) =>
          m.id === assistant.id ? { ...m, text: m.text + chunk } : m,
        )),
      });
    } catch (error) {
      setMessages((prev) => prev.filter((m) => m.id !== assistant.id));
      console.error(error);
    }
  }

  return (
    <section>
      {messages.map((m) => <p key={m.id}><b>{m.role}:</b> {m.text}</p>)}
      <button type="button" disabled={sending} onClick={() => submit('Hello')}>Send hello</button>
      {sending && <button type="button" onClick={abort}>Stop</button>}
    </section>
  );
}
```

### `useChorusStream(transport, opts?)`

```ts
const { send, abort, sending } = useChorusStream<MyMeta>(transport, { connector: 'openai' });
```

- `transport` — async function `(text, history: Message<TMeta>[], signal) => Promise<Response>`. Use `createFetchSSETransport<TMeta>(url)` or write your own.
- `send(..., { minDelayMs })` buffers the first streamed chunks until that many milliseconds have elapsed from send start, then flushes them before continuing normally.
- `send(..., { onReasoning, onSource, onToolDelta })` receives connector-emitted reasoning chunks, source/citation references, and accumulated tool deltas when you use the hook directly. `<Chorus>` wires these into `Message.reasoning`, `Message.sources`, and `role: 'tool'` messages automatically; advanced `onSend` bridges can pass `helpers.streamCallbacks?.()` to preserve the same behavior.
- `send(..., { onWarning })` receives non-fatal connector warnings (`ConnectorWarning` — `{ code, message, payload? }`) such as `truncated` (max-token stop) or safety notices. The stream is not aborted; `onDone` still fires. `<Chorus>` surfaces these through the `onStreamWarning` prop, and `helpers.streamCallbacks?.()` forwards them on the `onSend` bridge. When you drive the hook directly and omit `onWarning`, warnings are logged once in development instead.
- `send(..., { onMetadata })` receives free-form provider metadata (`Record<string, unknown>`) such as token `usage`, `finishReason`, `stopReason`, or `safetyRatings`. The stream is not aborted; `onDone` still fires. `<Chorus>` surfaces these through the `onStreamMetadata` prop, and `helpers.streamCallbacks?.()` forwards them on the `onSend` bridge. Omitting `onMetadata` drops the metadata silently.
- Non-abort transport, HTTP, connector, and in-band provider errors call `onError` when supplied and reject the returned `send()` promise. This lets README-style `await send(...)` bridges surface the friendly Chorus error banner through the surrounding `onSend` catch path.
- If `onError` itself throws while handling a stream error, Chorus warns in development and still rejects `send()` with the original stream error. If `onDone` throws after a successful stream, `send()` rejects with that completion callback error and does not call `onError`.
- `onError` receives raw transport details (including bounded HTTP response body snippets); the built-in UI continues to show only `errorMessage`.
- A 200 response that contains no SSE-shaped lines at all (for example a JSON `{"error":"missing key"}` or plain-text body served instead of `text/event-stream`) rejects `send()` with a `ChorusStreamError` whose message names Server-Sent Events, includes the response `Content-Type`, and previews the body — instead of completing silently with no chunks and no error. Truly empty/no-content bodies still resolve, and so does a valid `text/event-stream` that carried only `:` keepalive comments or named `event:` lines with no `data:` field (see [Named SSE events](guide.md#named-sse-events)).
- Calling `send()` while a previous `send()` is still in flight rejects the new call with a `ChorusStreamError` whose `code === 'concurrent-send'` (the previous send keeps running, the transport is not invoked a second time, and a dev-mode warning is logged). Custom shells that `await send(...)` can branch on `err instanceof ChorusStreamError && err.code === 'concurrent-send'` to keep their input/UI state intact, instead of mistaking the silent no-op for a successful empty stream. To start a fresh send, await the active promise or call `abort()` first.
- `opts.connector` — `'openai'` | `'anthropic'` | `'gemini'` | `'ai-sdk'` | `'auto'` | custom `Connector`. Defaults to `'auto'` which handles OpenAI, Gemini, Anthropic, and Vercel AI SDK JSON / data-stream frames, plain-text SSE, reasoning/source/tool deltas, and in-band `{ error }` payloads.
- `opts.connectorOptions` — options forwarded to the built-in connector named by `opts.connector`. Currently only `connector: 'openai'` consumes them (e.g. `{ thinkTag: { start: '<reasoning>', end: '</reasoning>' } }`). Ignored for other connector names and for custom `Connector` objects; in development a console warning fires when options are passed but the connector cannot apply them.
- If a connector exposes `createState()`, the hook creates one state object per `send()` and passes it to every `extract(data, state)` call for that stream. Do not store per-stream parser buffers in module globals; use connector state instead.

### `createFetchSSETransport(url, init?)`

Returns a `Transport` that POSTs to `url` and reads the response as a Server-Sent Events stream. With no `formatBody`, it sends JSON `{ prompt, history }` and defaults `Content-Type: application/json`. **`history` already includes the latest user turn; `prompt` is a duplicate convenience copy of `history[last].text`.** Server handlers should map `history` directly and ignore `prompt` — appending `prompt` to `history` will send the new user message to the model twice. With a custom `formatBody`, headers are left alone so FormData/Blob/URLSearchParams can set their own content type; add an explicit JSON Content-Type when your custom serializer returns JSON.

| Option | Type | Default | Description |
|---|---|---|---|
| `method` | `'GET' \| 'HEAD' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'` | `'POST'` | HTTP method. With `'GET'`/`'HEAD'`, `formatBody` and the default JSON `Content-Type` are skipped — encode state in query params on `url`. |
| `formatBody` | `(text, history: Message<TMeta>[]) => BodyInit` | `JSON.stringify({ prompt, history })` | Serialise the outgoing request body. `text` equals `history[last].text` — both arguments describe the same user turn. Custom serializers do not get an automatic JSON Content-Type. Ignored when `method` is `'GET'` or `'HEAD'`. |
| *(any `RequestInit` field)* | | | Forwarded to `fetch` (e.g. `headers`, `credentials`) |

```ts
import { createFetchSSETransport } from 'react-chorus';
import {
  formatAnthropicMessagesBody,
  formatGeminiGenerateContentBody,
  formatOpenAIChatCompletionsBody,
} from 'react-chorus/provider-requests';

// Provider-shaped JSON to your own server proxy (do not expose API keys in browser code)
const openAITransport = createFetchSSETransport('/api/openai-chat', {
  headers: { 'Content-Type': 'application/json' },
  formatBody: formatOpenAIChatCompletionsBody({ model: 'gpt-4o-mini' }),
});

const anthropicTransport = createFetchSSETransport('/api/anthropic-chat', {
  headers: { 'Content-Type': 'application/json' },
  formatBody: formatAnthropicMessagesBody({ model: 'claude-sonnet-4-6', max_tokens: 1024 }),
});

const geminiTransport = createFetchSSETransport('/api/gemini-chat', {
  headers: { 'Content-Type': 'application/json' },
  formatBody: formatGeminiGenerateContentBody({ generationConfig: { temperature: 0.2 } }),
});

// FastAPI / LangChain backend
const transport = createFetchSSETransport('/api/chat', {
  headers: { 'Content-Type': 'application/json' },
  formatBody: (_text, history) => JSON.stringify({ messages: history }),
});

// Multipart upload or custom body: no forced JSON Content-Type
const multipartTransport = createFetchSSETransport('/api/chat-with-files', {
  formatBody: (text, history) => {
    const form = new FormData();
    form.set('prompt', text);
    form.set('history', JSON.stringify(history));
    return form;
  },
});

// GET-based SSE proxy: state lives in the URL, no request body
const getTransport = createFetchSSETransport('/api/chat?conversationId=abc', { method: 'GET' });
```

### `createWebSocketTransport(url, opts?)`

Returns a `Transport` that connects over a native WebSocket. Each incoming message is wrapped as an SSE `data:` line so the existing connector pipeline works unchanged.

| Option | Type | Default | Description |
|---|---|---|---|
| `protocols` | `string \| string[]` | – | WebSocket sub-protocols passed to the constructor |
| `persistent` | `boolean` | `false` | Reuse one socket across sends instead of opening one socket per send |
| `onOpen` | `() => void` | – | Called once for each real WebSocket open transition |
| `onClose` | `(code: number, reason: string) => void` | – | Called once for each real WebSocket close transition, with the close code and reason |
| `onError` | `(event: Event) => void` | – | Called when the WebSocket reports an error |
| `onMessage` | `(data: string, event: MessageEvent) => void` | – | Observes every decoded WebSocket message; useful for persistent server-pushed updates when no send stream is active |
| `formatMessage` | `(text, history: Message<TMeta>[]) => string \| { payload: string; correlationId?: string \| null }` | `JSON.stringify({ prompt, history })` | Serialise the outgoing request. As with the fetch transport, `history` already includes the new user turn and `prompt`/`text` are duplicate copies — backends should consume `history` and ignore `prompt`. Return `{ payload, correlationId }` in persistent mode to register the active stream so `correlate` can route inbound frames to it |
| `correlate` | `(frame: string) => string \| null \| undefined` | – | Persistent mode only: extract the correlation id from each inbound frame. Non-null ids route the frame to the matching stream; `null`/`undefined` falls through to the legacy broadcast |

Default mode opens a fresh socket per send, then closes it when the response stream ends, the connector reports a done sentinel, or the `AbortSignal` fires. Serializer (`formatMessage`) and `ws.send()` failures reject the transport promise and close that socket, so they surface through `onError` like HTTP/SSE failures. Incoming string, `Blob`, `ArrayBuffer`, and typed-array messages are decoded as text; other message types error the response body instead of silently emitting an empty chunk.

Persistent mode opens a single socket on the first send and keeps it open across sends. The returned transport is still callable as a normal `Transport`, and also exposes `transport.close(code?, reason?)` for explicit cleanup; runtimes with `FinalizationRegistry` also attempt to close the persistent socket when the transport is garbage-collected, but UI code should call `close()` during unmount/dispose rather than relying on GC timing. `onOpen` and `onClose` fire for real socket transitions, not once per send. Because the socket stays open, application/server protocol code is responsible for reconnect/backoff and request/response correlation. **If sends can overlap (a second message starting before the first finishes, including the built-in Stop-then-resend flow) every inbound frame is broadcast to every active response stream, which duplicates payloads across assistant messages.** Pair a `formatMessage` that returns `{ payload, correlationId }` with `correlate(frame)` so each frame is dispatched to the request that started it; `correlate` returning `null`/`undefined` falls back to the broadcast (use this for server-pushed updates). The transport logs a one-time dev-mode warning the first time it sees overlapping sends without a `correlate` callback. Make sure each response emits a connector-specific done sentinel (or cancel the response body) so `useChorusStream` can finish the current send while the socket remains open.

```ts
let nextId = 0;
const transport = createWebSocketTransport('wss://api.example.com/chat', {
  persistent: true,
  formatMessage: (text, history) => {
    const id = String(++nextId);
    return { payload: JSON.stringify({ id, prompt: text, history }), correlationId: id };
  },
  correlate: (frame) => {
    try { return (JSON.parse(frame) as { id?: string }).id ?? null; } catch { return null; }
  },
});
```

### Custom connector

```ts
import type { Connector } from 'react-chorus';

const myConnector: Connector = {
  name: 'my-api',
  extract(data) {
    if (data === '[DONE]') return { done: true };
    const obj = JSON.parse(data);
    if (obj.error) return { error: typeof obj.error === 'string' ? obj.error : obj.error.message };
    return obj.token ? { text: obj.token } : null;
  },
};
```

Stateful connectors can isolate parser state per stream:

```ts
const bufferedConnector: Connector<{ buffer: string }> = {
  name: 'buffered-api',
  createState: () => ({ buffer: '' }),
  extract(data, state) {
    state!.buffer += data;
    // parse state.buffer and return { text }, { reasoning }, { source }, { toolDelta }, etc.
    return null;
  },
};
```

Return `{ source }` or `{ sources }` when your protocol emits citations. The source shape is the public `MessageSource` described above; `<Chorus>` appends those objects to the active assistant message's `sources` array, while direct `useChorusStream` consumers receive them through `onSource`.

**In-band errors.** Connectors can surface a provider error by returning `{ error: string }` (and optionally `errorPayload` with the original frame). Chorus treats that as a stream error: the assistant message is finalized, `streamError` is set, the error banner renders, and `onError` is called with a `ChorusStreamError`. The original provider payload is preserved on `error.errorPayload`/`error.cause` and on `streamRawError` for hosts that want to surface a richer banner via `renderError`.

```ts
import type { Connector } from 'react-chorus';

const myConnector: Connector = {
  name: 'my-api',
  extract(data) {
    if (data === '[DONE]') return { done: true };
    const obj = JSON.parse(data);
    if (obj.error) {
      return {
        error: typeof obj.error === 'string' ? obj.error : obj.error.message ?? 'Stream error',
        errorPayload: obj,
      };
    }
    return obj.token ? { text: obj.token } : null;
  },
};

<Chorus
  transport="/api/chat"
  connector={myConnector}
  onError={(err) => {
    // err is a ChorusStreamError; err.errorPayload is the original frame.
    console.error('stream failed:', err.message, err.errorPayload);
  }}
  renderError={({ error, rawError, retry, dismiss }) => (
    <div role="alert">
      <p>{error}</p>
      {rawError && 'errorPayload' in rawError && rawError.errorPayload ? (
        <pre>{JSON.stringify(rawError.errorPayload, null, 2)}</pre>
      ) : null}
      <button onClick={retry}>Retry</button>
      <button onClick={dismiss}>Dismiss</button>
    </div>
  )}
/>
```

The built-in connectors emit `{ error, errorPayload }` the same way when they detect a provider error frame (OpenAI `{ error: { message } }`, Anthropic `{ type: 'error' }`, Gemini blocked finish reasons, etc.), so the same `onError`/`renderError` wiring works for built-in and custom connectors.

## Serializing multimodal and tool-call history

`Message` is react-chorus' UI/storage shape. Provider APIs have stricter role and content schemas, so do not blindly send every item as `{ role: m.role, content: m.text }`: `tool` messages often need provider-specific IDs, system prompts may be top-level fields, and attachments need multimodal content parts.

Recommended patterns:

- Keep the default transport body (`{ prompt, history }`) and map `history` safely on your server with `toOpenAIChatCompletionsBody`, `toAnthropicMessagesBody`, or `toGeminiGenerateContentBody`. `history` already includes the latest user turn — `prompt` is a duplicate copy and the provider helpers read `history` only.
- Or pass a `format*Body` helper to `createFetchSSETransport('/api/chat', { formatBody, headers })` when your own backend expects a provider-shaped JSON body.
- Keep API keys in that backend proxy. Client-side `formatBody` is for shaping requests to your server, not for calling provider APIs directly with secrets.

### End-to-end image attachment recipe (OpenAI Chat Completions)

Front end: enable image selection, paste, and drop. The `accept` prop makes `<ChatInput>` read image files into `Message.attachments` as data URLs by default, and the normal `transport` path sends those attachments in `history`.

```tsx
<Chorus
  transport="/api/chat"
  connector="openai"
  accept="image/*"
  maxAttachmentBytes={2 * 1024 * 1024}
/>
```

Backend: use the OpenAI helper. It maps user image attachments to `image_url` parts and inserts a text note for unsupported attachments.

```js
import { toOpenAIChatCompletionsBody } from 'react-chorus/provider-requests';

const history = Array.isArray(req.body?.history) ? req.body.history : [];
const body = toOpenAIChatCompletionsBody(history, { model: 'gpt-4o-mini' });
const stream = await openai.chat.completions.create(body);
```

The runnable [`examples/with-next`](../examples/with-next) and [`examples/with-openai`](../examples/with-openai) apps use this helper. The Express app sets `express.json({ limit: '10mb' })`; on Next.js/serverless hosts, keep `maxAttachmentBytes` under the platform request limit. Inlined data URLs do not fit a large PDF or an image past a host's body limit — [upload those out-of-band](uploads.md) and send a `file_id`/`file_url` instead.

### Tool-call history recipe

Chorus displays tool steps as `role: 'tool'` with `message.toolCall`, but those messages are not a provider-neutral wire format. Connectors store the streamed provider id on `message.toolCall.id` when available. For OpenAI and Anthropic streams, Chorus also writes provider-aware metadata when the id came from the provider (not a generated fallback), so the request helpers can replay tool results exactly. For manually-created tool messages, store the same metadata yourself:

```ts
{
  role: 'tool',
  text: '',
  toolCall: { name: 'search', output: { results: [] } },
  metadata: {
    openai: { toolCallId: 'call_abc' },       // OpenAI Chat/Responses
    anthropic: { toolUseId: 'toolu_abc' },    // Anthropic Messages
  },
}
```

The request helpers use those IDs for OpenAI `tool_call_id` / Responses `call_id` and Anthropic `tool_result.tool_use_id`. They also synthesize the provider-required assistant tool-call records (`assistant.tool_calls`, Responses `function_call`, Anthropic `tool_use`) before the tool result. When an ID is missing, they convert the tool result to safe text context instead of emitting an invalid provider-specific tool message. Gemini function responses use `toolCall.name` and the output payload.

## Tool calls and agent steps

For agentic UIs, react-chorus provides first-class support for tool call rendering via the `role: 'tool'` message type.

### Streaming and execution lifecycle

On the built-in `transport` path, connector `toolDelta` events are display-only by default: Chorus creates or updates a visible `role: 'tool'` message and leaves execution to your app. A streamed tool call is considered complete when the provider stream ends (`[DONE]`, `message_stop`, a normal Gemini finish reason, or the response body closing). Tool-only turns end the sending state cleanly; because there is no assistant message, `onFinish` does not fire, but `onStreamDone` and/or `onToolCall` can observe the completed tool context.

The default `<ToolCallBlock>` renders an expandable input/output panel once a call has either. Before its arguments arrive — or for a call that legitimately produces no input and no output — it shows an explicit status row instead of an empty control: `Running…` while the turn is still streaming, `No output` once it has settled. Both strings are localizable via `labels.toolCall.running` / `labels.toolCall.empty`.

To observe deltas without executing tools:

```tsx
<Chorus
  transport="/api/chat"
  connector="openai"
  onToolDelta={({ delta, message }) => {
    console.log('tool update', delta.id, message.toolCall.input);
  }}
  onStreamDone={({ toolMessages }) => {
    console.log('completed tool calls', toolMessages);
  }}
/>
```

To execute tools in the simple path, pass a `tools` registry. Handlers run after streaming input completes, receive the final parsed `input` plus an abortable context, and their return value is appended as `toolCall.output`. If the user clicks Stop while a handler is running, `context.signal` is aborted and late outputs are ignored. If a handler throws a non-abort error, Chorus keeps the tool row inspectable and writes `{ error: message }` to its output (and flags `metadata.isError`). By default it then ends the turn — calling `onError` and showing the friendly error banner; clicking Retry removes the failed assistant/tool attempt before rendering the fresh response.

To make a thrown tool error recoverable instead of terminal, set `continueOnToolError`. The error output is then treated as a normal tool result: the already-streamed assistant text from that iteration is kept, no error banner is shown, and — with `autoContinueTools` enabled — the loop continues and feeds the error tool result back to the model (as `is_error: true` for Anthropic) so it can apologize or try a different approach. Abort errors from Stop always end the turn regardless of this flag.

By default this remains display/manual mode: Chorus does not make a second model request after tool execution, so use `onToolCall`/`onStreamDone` or your backend to continue the agent loop when needed. To opt in to a built-in loop, set `autoContinueTools`. Chorus will run the handlers, append outputs, then send a continuation request with the updated history. `maxToolIterations` (default `4`) prevents runaway loops, `shouldContinueToolLoop(context)` can stop a specific continuation, and Stop aborts both tool execution and continuation streams. When the cap fires (or any other terminal condition), `onStreamDone` receives a `reason` (`'max-tool-iterations' | 'tool-loop-veto' | 'tool-loop-continue' | 'completed'`) plus `willContinue`, `iteration`, and `maxToolIterations` — hosts decide how to surface the cap in their UI (Chorus deliberately does not render a default banner).

#### One source of truth for schema + handler

`defineTool` produces a `ChorusToolDefinition` that pairs the model-facing name, description, and input JSON Schema with the local handler. Pass the input type as `defineTool<TInput>(...)` so `handler`'s `input` argument is typed without an `as` cast. Pass the same array to `<Chorus tools={...} />` to execute calls and to the provider-request helpers to advertise the schema — so a typo or schema drift can't slip in between client and server:

```ts
// tools.ts — shared by both the React app and your backend
import { defineTool } from 'react-chorus';

export const searchTool = defineTool<{ q: string }>({
  name: 'search',
  description: 'Search the docs for a query string',
  inputSchema: {
    type: 'object',
    properties: { q: { type: 'string', description: 'query text' } },
    required: ['q'],
  },
  // Optional per-provider overrides merged into the generated tool entry:
  // openai: { strict: true }, anthropic: { cache_control: { type: 'ephemeral' } },
  handler: async (input, { signal }) => {
    // `input` is typed `{ q: string }` from the generic — no `as` cast needed.
    const { q } = input;
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal });
    return res.json();
  },
});

export const tools = [searchTool];
```

```tsx
// client: register handlers + advertise to the model in one place
import { Chorus } from 'react-chorus';
import { tools } from './tools';

<Chorus
  transport="/api/chat"
  connector="openai"
  tools={tools}
  autoContinueTools
  maxToolIterations={2}
/>
```

```ts
// server: same array → provider-specific tool declarations
import { toOpenAIChatCompletionsBody } from 'react-chorus/provider-requests';
import { tools } from '../tools';

const body = toOpenAIChatCompletionsBody(history, { model: 'gpt-4o-mini', tools });
// body.tools === [{ type: 'function', function: { name: 'search', description: ..., parameters: ... } }]
const stream = await openai.chat.completions.create(body);
```

The body helpers detect Chorus-shaped definitions and serialize them. For Anthropic and Gemini the equivalent helpers (`toAnthropicMessagesBody`, `toGeminiGenerateContentBody`) emit `input_schema` and `functionDeclarations` respectively. Standalone serializers (`toOpenAIChatCompletionsTools`, `toOpenAIResponsesTools`, `toAnthropicTools`, `toGeminiTools`) are exported when you want the `tools` field on its own. If you pass an already-shaped provider tools array as `tools`, the helpers leave it untouched as an escape hatch.

The legacy `Record<name, handler>` shape still works for handler-only registries when you have no schema to advertise:

```tsx
<Chorus
  transport="/api/chat"
  connector="openai"
  tools={{
    search: async (input, { signal }) => { /* ... */ },
  }}
  onToolCall={({ name, input, output }) => {
    // When a matching tools[name] handler exists, this is an observer; its
    // return value is ignored. Without a tools handler, returning a value here
    // appends that value as toolCall.output.
    console.log(name, input, output);
  }}
/>
```

### Built-in rendering

Push a message with `role: 'tool'` and a `toolCall` payload. `ChatWindow` renders it as a collapsible block automatically:

```tsx
setMessages(prev => [
  ...prev,
  {
    id: crypto.randomUUID(),
    role: 'tool',
    text: '',
    toolCall: {
      name: 'search_web',
      input: { query: 'react streaming SSE' },
      output: { results: ['...'] },
    },
  },
]);
```

The block shows the tool name in a header. Clicking expands it to reveal the input and output formatted as JSON. `<Chorus>` shows tool messages by default while hiding system messages; pass `hiddenRoles={['system', 'tool']}` to hide them. Standalone `<ChatWindow>` keeps its historical default of hiding both `system` and `tool` unless you pass `hiddenRoles={['system']}`.

### Custom renderer via `renderMessage`

Supply a `renderMessage` render-prop to take full control of how any message is displayed. Return `null` to fall back to the default renderer for that message. The second argument is a `RenderMessageContext`:

```ts
interface RenderMessageContext<TMeta = Record<string, unknown>> {
  /** The message currently being rendered. */
  message: Message<TMeta>;
  /** True while this message is the active streaming assistant turn. */
  isStreaming: boolean;
  /**
   * True while this message's built-in inline editor is active (the Edit button has been clicked
   * and Save/Cancel has not yet fired). Skip rendering your own bubble/content when this is true
   * so the inline editor rendered by `ctx.actions.defaultRender()` replaces the row instead of
   * sitting alongside the original content.
   */
  isEditing: boolean;
  /** Calls the default Chorus renderer for this message; pass optional slots to decorate the bubble. */
  defaultRender: (slots?: MessageBubbleSlots) => React.ReactNode;
  /** Spread on a custom row root so `ChorusRef.scrollToMessage(id)` can target it. */
  messageProps: RenderMessageRootProps; // { 'data-chorus-message-id': string }
  /** Built-in actions (edit/regenerate/copy/delete/feedback) plus their default-rendered controls. */
  actions: MessageRenderActions;
}

interface MessageRenderActions {
  /** Per-action availability flags reflecting current Chorus state (disabled/read-only, role, sending). */
  canEdit: boolean;
  canRegenerate: boolean;
  canDelete: boolean;
  /** Saves a message edit. The built-in inline editor calls this with a non-empty trimmed string. */
  edit?: (newText: string) => void;
  regenerate?: () => void;
  delete?: () => void;
  /** Returns boolean | void | Promise<boolean | void>; built-in controls show "Copy failed" on explicit false. */
  copy?: () => MessageCopyResult;
  feedback?: (variant: MessageFeedback | null) => void; // null clears the rating
  /** Current persisted feedback selection used to seed the built-in thumb state. */
  initialFeedback?: MessageFeedback | null;
  /** Renders the built-in action controls (Copy/Edit/Regenerate/Delete/Feedback) for this message. */
  defaultRender: () => React.ReactNode;
}

interface MessageBubbleSlots {
  before?: React.ReactNode;       // before the bubble (avatars, etc.)
  headerSlot?: React.ReactNode;   // inside .chorus-msg-content, above .chorus-bubble
  footerSlot?: React.ReactNode;   // inside .chorus-msg-content, below .chorus-bubble
  after?: React.ReactNode;        // after the bubble
}

interface RenderMessageRootProps {
  'data-chorus-message-id': string;
}
```

`edit`, `regenerate`, `delete`, and `feedback` are only set when those actions are available for the message and the current Chorus state — for example `edit` is omitted while the chat is disabled/read-only or for non-user messages. Clicking the already-active thumb in the built-in controls toggles the rating off and calls `feedback(null)`; a custom row can clear feedback the same way by calling `feedback(null)`. `actions.defaultRender()` renders the built-in control row exactly as `defaultRender()` would.

The built-in inline editor owns edit trimming: when it saves, `edit` (and the underlying `onEdit`) receives a non-empty trimmed string, and an all-whitespace edit cancels instead of firing the callback. This holds for both default rendering and custom `renderMessage` rows, so optimistic UI can use the value directly. A fully custom editor that calls `ctx.actions.edit` itself is responsible for its own trimming.

#### Editing inside a custom row

`ctx.actions.defaultRender()` swaps the action row out for the built-in inline editor while editing is active, then restores keyboard focus to the originating Edit button after Save or Cancel (including Escape). To keep that contract working in a custom row, the renderer needs to hide its own bubble/content while editing so the editor replaces the original message instead of rendering alongside it:

- The exported `<MessageBubble>` already opts in automatically — it reads `ctx.isEditing` from context and returns `null` while its own message is being edited, so the README pattern (`<MessageBubble />` + `ctx.actions.defaultRender()`) needs no extra wiring.
- The built-in `ctx.defaultRender()` row drives `ctx.isEditing` too — clicking its own Edit button flips the context flag, so `{!ctx.isEditing && <MyBubble />}{ctx.defaultRender()}` hides the custom content instead of stacking it above the row's inline editor.
- Custom DOM rows should gate their content on `ctx.isEditing`, e.g. `{!ctx.isEditing && <MyBubble message={msg} />}`. While `ctx.isEditing` is true, render only `ctx.actions.defaultRender()` (or your own editor) for that message.

```tsx
renderMessage={(msg, ctx) => (
  <div {...ctx.messageProps} className="my-row">
    {!ctx.isEditing && <MyBubble message={msg} streaming={ctx.isStreaming} />}
    {ctx.actions.defaultRender()}
  </div>
)}
```

For fully custom DOM rows, spread `ctx.messageProps` on the outer element you want `ChorusRef.scrollToMessage(id)` to target. Chorus automatically adds those props to a single DOM element returned directly from `renderMessage`, but spread them yourself when returning a fragment or custom component. Built-in `ctx.defaultRender()` and `<MessageBubble>` already include a scroll target.

```tsx
<Chorus
  messages={messages}
  hiddenRoles={['system']} // show tool calls while still hiding system prompts
  renderMessage={(msg, ctx) => {
    if (msg.role === 'tool') {
      return (
        <div key={msg.id} {...ctx.messageProps} className="my-tool-step">
          <strong>{msg.toolCall.name}</strong>
          <pre>{JSON.stringify(msg.toolCall.output, null, 2)}</pre>
        </div>
      );
    }

    if (msg.role === 'assistant') {
      return (
        <>
          <MessageBubble message={msg} streaming={ctx.isStreaming} />
          {ctx.actions.defaultRender()}
        </>
      );
    }

    return null; // use default rendering for other messages
  }}
/>
```

Or use the exported `<ToolCallBlock>` component directly in your own layout — see the [`<ToolCallBlock>` reference](#toolcallblock-component) below.

### `ToolCallBlock` component

`ToolCallBlock` renders a single tool call as a collapsible block (header with the tool name, expanded input/output sections, status row for empty calls). It is re-exported from the package barrel so a custom shell can drop it into any layout — a sidebar panel, a custom `renderMessage` row, or a hand-rolled transcript built around `useChorusStream` — without rebuilding the running/empty/expand affordances.

```tsx
import { ToolCallBlock } from 'react-chorus';

interface ToolCallBlockProps {
  toolCall: ToolCall;
  labels?: Partial<ChorusToolCallLabels>; // localizes 'Input' / 'Output' / 'Running…' / 'No output'
  streaming?: boolean;                    // shows 'Running…' instead of 'No output' while an empty call is in flight
  className?: string;                     // appended after 'chorus-tool-call' on the root via joinClasses
  style?: React.CSSProperties;            // merged onto the root .chorus-tool-call element
}

<ToolCallBlock
  toolCall={{ name: 'read_file', input: { path: '/etc/hosts' }, output: '127.0.0.1 localhost' }}
/>
```

`className` is merged with the built-in `'chorus-tool-call'` hook so the host class stacks after the default; pass it to add a Tailwind/Emotion class, a test-id-style hook, or any other custom selector without losing default styling or palette wiring. `style` is forwarded to the same root element. Use these when a custom shell composes `MessageBubble` / `MessageRow` (which already accept `toolCallClassName` / `toolCallStyle` and forward them here) or renders `<ToolCallBlock>` directly:

```tsx
<ToolCallBlock
  toolCall={toolCall}
  className="my-tool-row"
  data-testid="tool-call" /* not currently forwarded — wrap in a div for arbitrary data-* */
/>
```

The built-in palette knobs (`toolBorder`, `toolHeaderBg`, …) and the underlying `--chorus-tool-*` CSS variables remain the recommended way to recolor the block; reach for `className`/`style` when you need class-based theming (Tailwind, Emotion) or layout overrides that CSS variables cannot express.

### `Markdown` component

`Markdown` renders a CommonMark + GFM string with optional syntax-highlighted code blocks and per-block copy chrome. It is the same renderer `<Chorus>` uses for assistant text, exported so a custom shell can render Markdown outside a transcript — a release-notes panel, a Markdown preview of a user draft, or a tool-result viewer — without re-wiring sanitization and highlighting.

```tsx
import { Markdown } from 'react-chorus';

interface MarkdownProps {
  text: string;
  codeTheme?: 'dark' | 'light';
  headless?: boolean;        // skip default styles + highlight.js theme injection
  streaming?: boolean;       // render escaped plain text instead of reparsing for each chunk
  sanitizer?: MarkdownSanitizer;       // custom DOMPurify-compatible sanitizer (SSR/CSP)
  markedOptions?: MarkedOptions;       // per-instance Marked config
  markedExtensions?: MarkedExtension[]; // per-instance Marked extensions
  codeCopyLabels?: ChorusCodeCopyLabels; // localize the per-code-block copy button
  onCopyError?: (error: Error) => void;  // clipboard failure observer
  codeBlockCopy?: CodeBlockCopy;       // 'default' | true | false | (ctx) => htmlString
}

<Markdown text="**Hello** _world_" codeTheme="dark" />
```

In production builds Chorus uses a built-in **safe-mode** renderer that drops raw HTML; pass a `sanitizer` (for example a DOMPurify wrapper) when you specifically need sanitized HTML (server-rendered output, or content you trust enough to allow inline markup). `streaming` is for when you drive the renderer yourself with a partial document: instead of reparsing the half-written Markdown on every chunk, it renders React-escaped pre-wrap plain text until you finalize. Switch it off (the default) for finalized text.

Customize the per-code-block copy chrome with `codeBlockCopy`:

```tsx
import type { CodeBlockCopyContext } from 'react-chorus';

const codeBlockCopy = (ctx: CodeBlockCopyContext) =>
  `<div class="my-toolbar"><span>${ctx.language ?? 'code'}</span><button class="chorus-copy-btn">copy</button></div>`;

<Markdown text={text} codeBlockCopy={codeBlockCopy} />;
```

Return any HTML string from the renderer; include a `chorus-copy-btn` element to keep the built-in clipboard wiring. Pass `codeBlockCopy={false}` to drop the chrome entirely while keeping the styled code-block wrapper, or `codeBlockCopy={'default'}` (the default) for the bundled accessible copy button. `headless` mode never injects this chrome regardless of the prop.

For headless-by-default Markdown without `<style>` injection or the highlight.js theme, import from the headless subpath instead: `import { Markdown } from 'react-chorus/headless'` — see [Headless subpath](#headless-subpath).

### `MessageBubble` component

`MessageBubble` renders the default bubble for a single message, including attachments. Import it to use as a base when you only need to add decoration (avatars, timestamps, status badges) around the existing look. It respects `headless` mode by forwarding `headless` to Markdown.

```tsx
import { MessageBubble } from 'react-chorus';

// props
interface MessageBubbleProps<TMeta = Record<string, unknown>> {
  message: Message<TMeta>;     // the message to render, including attachments
  className?: string;          // merged onto the outer .chorus-msg element
  style?: React.CSSProperties; // merged onto the outer .chorus-msg element
  codeTheme?: 'dark' | 'light'; // defaults to 'dark'
  headless?: boolean;          // forwards headless mode to Markdown; defaults to false
  streaming?: boolean;         // forwards Markdown's escaped plain-text streaming mode
  markdownProps?: MessageMarkdownProps;
  markdownSanitizer?: MarkdownSanitizer;
  toolCallClassName?: string;       // forwarded to the embedded <ToolCallBlock> for role: 'tool' messages
  toolCallStyle?: React.CSSProperties; // forwarded to the embedded <ToolCallBlock> for role: 'tool' messages
  before?: React.ReactNode;      // rendered before .chorus-msg-content (for avatars)
  headerSlot?: React.ReactNode;  // rendered above .chorus-bubble inside .chorus-msg-content
  footerSlot?: React.ReactNode;  // rendered below .chorus-bubble inside .chorus-msg-content
  after?: React.ReactNode;       // rendered after .chorus-msg-content
}
```

Example — custom bubble color per role without changing layout:

```tsx
<MessageBubble
  message={message}
  className="my-bubble"
  style={{ opacity: message.role === 'assistant' ? 0.9 : 1 }}
/>
```

Example — add decoration slots while preserving the default bubble and action layout:

```tsx
<MessageBubble
  message={message}
  before={<Avatar role={message.role} />}
  headerSlot={<span>{message.role === 'user' ? 'You' : 'Assistant'} · 14:32</span>}
  footerSlot={<span>{message.metadata?.model}</span>}
/>
```

When you only need slots around the built-in renderer from `renderMessage`, call `ctx.defaultRender({ before, headerSlot, footerSlot, after })` and return it.

### Default renderer

When neither `renderMessage` nor a custom `MessageBubble` is used, each message renders as:

```html
<div class="chorus-msg chorus-{role}" data-chorus-message-id="...">
  <span class="chorus-sr-only">User message</span>
  <div class="chorus-msg-content">
    <details class="chorus-reasoning"><!-- optional reasoning trace --></details>
    <div class="chorus-bubble"><!-- attachments + Markdown content --></div>
    <div class="chorus-actions"><!-- optional action buttons --></div>
  </div>
</div>
```

`<MessageBubble message={message} />` uses the same `.chorus-msg > .chorus-msg-content > .chorus-bubble` structure, so it preserves the default message width and role alignment when used from `renderMessage`.

Each built-in row and `<MessageBubble>` includes a visually hidden `.chorus-sr-only` speaker label (`User message`, `Assistant message`, `System message`, or `Tool message`) so screen readers announce who spoke without changing the visual layout.

`.chorus-actions` is hover-revealed on pointer devices but switches to always-visible under `@media (hover: none), (pointer: coarse)` so touch users can still discover Copy/Edit/Regenerate/Delete/Feedback. Set `alwaysShowMessageActions` on `<Chorus>` (or apply `.chorus--always-show-actions` to the root yourself) to keep actions visible on hover-capable devices too.

Target these classes in your CSS to restyle without a render prop:

```css
.chorus-msg.chorus-user   .chorus-bubble { background: #0070f3; color: #fff; }
.chorus-msg.chorus-assistant .chorus-bubble { background: #f0f0f0; color: #111; }
```

Reasoning blocks reuse existing palette variables (`--chorus-chat-bg`, `--chorus-chat-text`, `--chorus-border`, `--chorus-action-text`, and hover tokens), so they follow your `<Chorus palette={…}>` theme automatically.

### CSS custom properties for tool blocks

Built-in tool call blocks can be themed through palette keys (`toolBorder`, `toolHeaderBg`, `toolHeaderText`, `toolHeaderHover`, `toolNameText`, `toolBodyBg`, `toolLabelText`, `toolCodeText`, and `toolRunningText`). For advanced CSS-only overrides, use the underlying CSS variables directly:

```css
:root {
  --chorus-tool-border: #333;
  --chorus-tool-header-bg: #1a1a1a;
  --chorus-tool-header-text: #999;
  --chorus-tool-header-hover: #222;
  --chorus-tool-name-text: #e6edf3;
  --chorus-tool-body-bg: #111;
  --chorus-tool-label-text: #666;
  --chorus-tool-code-text: #e6edf3;
  --chorus-tool-running-text: #a3a3a3; /* "Running…" status while a call is in flight */
}
```

## Theming

Theming is a single mechanism: a **`palette`** object that maps to `--chorus-*` CSS custom properties. Every exported root component — `Chorus`, `ChatWindow`, `ChatInput`, and `ConversationList` — accepts a `palette` prop and writes those variables onto its own root element. `<ChorusTheme>` is the same mechanism without a component: a bare `<div>` that carries the variables for any subtree, handy when you compose the pieces yourself.

```tsx
// Full widget — theme it directly.
<Chorus
  palette={{
    chatBg: '#0f0f0f',
    assistantBubbleBg: '#6366f1',
    assistantText: '#ffffff',
    userBubbleBg: '#e5e7eb',
    toolHeaderBg: '#18181b',
    toolNameText: '#f4f4f5',
  }}
  onSend={…}
/>

// Composed shell — theme each piece via its own `palette` prop…
<ChatWindow messages={messages} palette={{ chatBg: '#0f0f0f' }} />
<ChatInput value={value} onChange={setValue} onSend={onSend} palette={{ inputBg: '#1a1a1a' }} />

// …or wrap the whole subtree once with <ChorusTheme>.
<ChorusTheme palette={{ chatBg: '#0f0f0f', inputBg: '#1a1a1a' }}>
  <ChatWindow messages={messages} />
  <ChatInput value={value} onChange={setValue} onSend={onSend} />
</ChorusTheme>
```

A per-component `palette` prop and a `<ChorusTheme palette={…}>` wrapper are interchangeable: both emit the same `--chorus-*` variables, only the DOM element they land on differs. The `palette` is applied the same way on the default and `react-chorus/headless` exports — `headless` controls injected `<style>` tags and code-block chrome, not the host-supplied theme.

### Theming precedence

Theming resolves through the **standard CSS custom-property cascade** — there is no JavaScript-level merge between layers. `styleVarsFromPalette` only emits a variable for a palette key you actually set, so resolution is *per variable*:

1. The **nearest ancestor — or the element itself — that sets a given `--chorus-*` variable wins.** A component's own `palette` prop sits closest to its own DOM, so it overrides an ancestor `<ChorusTheme>` or `<Chorus palette>` for the keys it defines — but only those keys; keys it omits keep inheriting from the ancestor.
2. **Host CSS variables** (e.g. `--chorus-chat-bg` declared on `:root` or any ancestor in your own stylesheet) join the same cascade. A closer `palette`/`ChorusTheme` overrides them; they in turn override the bundled defaults.
3. The **bundled stylesheet defaults** (the `var(--chorus-chat-bg, #161616)` fallbacks in `Chorus.css`) apply when nothing else sets the variable.

So `<ChorusTheme palette={A}><Chorus palette={B} /></ChorusTheme>` renders `<Chorus>` with `B` winning, falling back to `A` for any key `B` omits, then to host CSS variables, then to the built-in defaults.

Available palette keys: `chatBg`, `chatText`, `border`, `assistantBubbleBg`, `assistantText`, `assistantBorder`, `userBubbleBg`, `userText`, `userBorder`, `inputAreaBg`, `inputBg`, `inputText`, `inputBorder`, `sendButtonBg`, `sendButtonText`, `focusRing`, `actionText`, `actionHoverBg`, `actionHoverText`, `errorBg`, `errorBorder`, `errorText`, `toolBorder`, `toolHeaderBg`, `toolHeaderText`, `toolHeaderHover`, `toolNameText`, `toolBodyBg`, `toolLabelText`, `toolCodeText`, `toolRunningText`.

### Reduced motion

The bundled stylesheet honors `@media (prefers-reduced-motion: reduce)`: the attachment-upload spinner and the assistant typing dots stop animating (dots remain visible at full opacity), and non-essential hover/focus transitions on the textarea and message-action buttons are disabled. Focus rings remain visible regardless of motion preference. If you replace `Chorus.css` with your own stylesheet or use the `react-chorus/headless` subpath, you are responsible for providing equivalent reduced-motion handling.

### Right-to-left (RTL) locales

The bundled stylesheet uses CSS logical properties (`inset-inline-start` / `inset-inline-end`, `padding-inline-*`, `margin-inline-*`, `text-align: start`) for the composer, sidebar, and tool-call surfaces, so wrapping `<Chorus>` in any ancestor with `dir="rtl"` (or setting `document.documentElement.dir = 'rtl'`) is enough to mirror the layout: the paperclip moves to the visual right, the send button moves to the visual left, textarea padding flips, and conversation list affordances reverse. No new prop is required — Chorus inherits direction from the surrounding DOM. Pair this with `ChorusLabels` to localize the UI strings themselves.

## Individual Components

You can compose the UI from smaller pieces:

```tsx
import { ChatWindow, ChatInput, ChorusTheme, Markdown } from 'react-chorus';
```

- **`<ChatWindow messages={…} typing={…} />`** — renders the scrollable message list with empty-state prompts, a typing indicator, errors, the optional floating jump-to-latest button, and optional `maxRenderedMessages` windowing. It accepts `hiddenRoles?: Role[]` (default `['system', 'tool']`); `showSystemMessages` is deprecated but remains supported as an alias for showing all roles. `showJumpToBottomButton?: boolean` defaults to `!headless` and toggles the floating “Jump to latest” button that surfaces when the user scrolls away from the bottom and new activity arrives — pass `false` to disable it and render your own affordance. Pass `markdownSanitizer`, `markdownProps`, `renderError`, or `renderMessage` to customize built-in rendering. Accepts a `palette` prop (see [Theming](#theming)).
- **`<ChatInput value onSend onStop placeholder sending />`** — the text input, send/stop button, disabled/read-only states, and optional attachment composer (`accept`, paste/drop, limits, cancellable `uploadAttachment`). Accepts a `palette` prop (see [Theming](#theming)). It is `forwardRef`-enabled: pass a `ChatInputHandle` ref to imperatively `focus()` the composer (with optional `ChatInputFocusOptions` caret placement) from a custom shell.
- **`<ChorusTheme palette={…}>`** — applies the `--chorus-*` theme variables to any subtree; the standalone form of the `palette` prop carried by `Chorus`, `ChatWindow`, `ChatInput`, and `ConversationList`. See [Theming](#theming) for the precedence rules.
- **`<Markdown text={…} codeTheme="dark" />`** — standalone markdown renderer with syntax highlighting and copy buttons. It supports `streaming` to render escaped plain text until finalization, `sanitizer` to provide a custom DOMPurify-compatible sanitizer when SSR needs sanitized raw HTML instead of the built-in no-raw-HTML safe mode, `markedOptions`/`markedExtensions` for per-instance parser customization, `onCopyError` for clipboard-copy failures, and `codeBlockCopy` to disable or fully customize the per-code-block copy chrome.
- **`<MessageBubble message={…} />`** — renders the default bubble for one message, including attachments and screen-reader speaker labels. Accepts `className`, `style`, `codeTheme`, `headless`, `streaming`, `markdownProps`, `markdownSanitizer`, and decoration slots (`before`, `headerSlot`, `footerSlot`, `after`) without replacing the full renderer.

### Headless subpath

Import from `react-chorus/headless` when you want semantic markup and behavior without default styling. The headless subpath preserves class names as styling hooks, and its `Chorus`, `ChatWindow`, `MessageBubble`, `ConversationList`, and `Markdown` exports default `headless={true}` so Markdown styles and syntax-highlight theme CSS are not injected unless you explicitly pass `headless={false}`. It re-exports the same public message, attachment, upload, streaming, and persistence types as the root entry point so `ChatInput` handlers can be typed from the subpath alone.

When `headless` is in effect, the `ChatWindow` and `ConversationList` roots also carry a `--headless` modifier class (`chorus-window--headless` and `chorus-conversation-list--headless`) alongside their base class, so a stylesheet can target the headless build specifically (for example, to opt those roots into a custom layout).

Because `showJumpToBottomButton` defaults to `!headless`, the floating jump button is off on the headless exports. Pass `showJumpToBottomButton={true}` to opt the built-in button back in, or leave it off and render your own jump-to-latest UI from the same "auto-scroll paused" + "has unread activity" signals the built-in button reacts to — track them with a scroll listener on the `ChatWindow` ref (the built-in `useAutoScroll` helper compares `scrollHeight - scrollTop - clientHeight` against a 48 px near-bottom threshold and flags unread activity when a new message arrives while paused).

```tsx
import { ChatWindow, ConversationList, Markdown, MessageBubble } from 'react-chorus/headless';

<ChatWindow messages={messages} />
<MessageBubble message={message} />
<ConversationList {...conversations} />
<Markdown text="**unstyled**" />
```

The full set of named exports available from `react-chorus/headless`:

Components (default `headless={true}`):

- `Chorus`, `ChorusHeadless` — `<Chorus>` with `headless` defaulting to true; both names refer to the same component.
- `ChatWindow` — transcript with `headless` default true so Markdown styling is not injected.
- `MessageBubble` — single message bubble with `headless` default true.
- `ConversationList` — sidebar with `headless` default true.
- `Markdown` — Markdown renderer with `headless` default true (no `<style>` tag, no highlight.js theme).

Pass-through components and theming (re-exported from the root barrel):

- `ChatInput`, `ToolCallBlock`, `ChorusTheme`. These are re-exported unchanged — unlike the wrapped components above, they do **not** default `headless={true}`. Only `Chorus`/`ChatWindow`/`MessageBubble`/`Markdown`/`ConversationList` are wrapped with that default. For an unstyled composer or tool-call block, pass `headless` explicitly (e.g. `<ChatInput headless />`, `<ToolCallBlock headless />`).

Hooks:

- `useChorusStream` — core SSE streaming hook for the simple `transport` path.
- `useChorusPersistence` — read/write a single transcript through a `StorageAdapter`.
- `useConversations` — conversation index + per-conversation transcript storage.
- `useChorusTranscriptActions` — headless transcript search / copy-all / export-as helper for a search box, "copy conversation" button, or "download transcript" affordance.

Helpers and constants:

- `createFetchSSETransport`, `createWebSocketTransport` — transport factories.
- `defineTool` — typed tool definition for `<Chorus tools>` + provider request helpers.
- `getConnector`, `createOpenAIConnector` — connector accessors. `getConnector(name, options?)` resolves a built-in connector by name (`'openai'` / `'anthropic'` / `'gemini'` / `'ai-sdk'` / `'auto'`); `createOpenAIConnector(options?)` builds a customized OpenAI connector object.
- `formatAiSdkModelMessagesBody`, `formatAnthropicMessagesBody`, `formatGeminiGenerateContentBody`, `formatOpenAIChatCompletionsBody`, `formatOpenAIResponsesBody`, `toAiSdkModelMessages`, `toAiSdkModelMessagesBody`, `toAnthropicMessages`, `toAnthropicMessagesBody`, `toAnthropicTools`, `toGeminiContents`, `toGeminiGenerateContentBody`, `toGeminiTools`, `toOpenAIChatCompletionsBody`, `toOpenAIChatCompletionsMessages`, `toOpenAIChatCompletionsTools`, `toOpenAIResponsesBody`, `toOpenAIResponsesInput`, `toOpenAIResponsesTools` — provider request mappers.
- `ChorusStreamError` — error class thrown by `useChorusStream` and the transport path.
- `DEFAULT_CHORUS_LABELS`, `DEFAULT_ATTACHMENT_LABELS`, `DEFAULT_SOURCE_LABELS`, `resolveChorusLabels` — built-in localization helpers and label defaults (`DEFAULT_ATTACHMENT_LABELS` / `DEFAULT_SOURCE_LABELS` expose individual English slices).
- `sourceDisplayLabel(source, fallback)` — returns the display label the default `MessageSources` UI shows for a `MessageSource` (priority order: `title || url || id || fallback`). Use it in custom source-list renderers to match the built-in label.

Types: every public type re-exported from the root barrel is also importable from `react-chorus/headless` — including `Message`, `AnyChorusMessage`, `UserMessage`, `AssistantMessage`, `SystemMessage`, `ToolMessage`, `Role`, `ToolCall`, `MessageSource`, `MessageCitation`, `MessageSourceType`, `Attachment`, `AttachmentError`, `AttachmentErrorReason`, `AttachmentSource`, `AttachmentUploadResult`, `UploadAttachment`, `UploadAttachmentOptions`, `StorageAdapter`, `ConnectorName`, `Connector`, `ConnectorResult`, `ConnectorToolDelta`, `Transport`, `FetchSSETransportOptions`, `FetchTransportInit`, `WebSocketTransport`, `WebSocketTransportOptions`, `SendCallbacks`, `StreamOptions`, `ChorusProps` (aliased to `ChorusHeadlessProps`), `ChorusRef`, `ChorusSendHelpers`, `ChorusSendPath`, `ChorusOnSend`, `ChorusOnFinish`, `ChorusOnAbort`, `ChorusOnStreamDone`, `ChorusOnToolCall`, `ChorusOnToolDelta`, `ChorusAbortContext`, `ChorusAbortReason`, `ChorusAbortSource`, `ChorusFinishContext`, `ChorusStreamDoneContext`, `ChorusStreamDoneReason`, `ChorusToolCallContext`, `ChorusToolDeltaContext`, `ChorusToolLoopContext`, `ChorusToolRegistry`, `ChorusToolHandler`, `ChorusConfirmClearConversation`, `ChorusClearConversationContext`, `ChorusConfirmDeleteMessage`, `ChorusDeleteMessageContext`, `ChorusShouldContinueToolLoop`, `ChorusMessagesChangeContext`, `ChorusMessagesChangeReason`, `ChorusMessagesChangeSource`, `ChorusToolDefinition`, `RenderErrorContext`, `RenderMessageContext`, `RenderMessageRootProps`, `MessageBubbleProps`, `MessageBubbleSlots`, `MessageMarkdownProps`, `MessageRenderActions`, `MessageTimestampFormatter`, `MessageCopyResult`, `MessageFeedback`, `GetMessageFeedback`, `ChatInputProps`, `ChatInputHandle`, `ChatInputFocusOptions`, `ChatWindowProps`, `ConversationListProps`, `ConfirmDeleteConversation`, `ConfirmDeleteConversationContext`, `ConversationStorageError`, `ConversationStorageOperation`, `ConversationSummary`, `RenameFromFirstMessageOptions`, `UseConversationsOptions`, `UseConversationsResult`, `ChorusPersistenceError`, `PersistenceOperation`, `PersistenceWriteOptions`, `SerializeMessages`, `DeserializeMessages`, `UseChorusPersistenceOptions`, `UseChorusPersistenceResult`, `ChorusTranscriptActions`, `ChorusTranscriptActionsOptions`, `TranscriptExportFormat`, `TranscriptFormatInfo`, `RenderAttachmentErrorContext`, `Palette`, `MarkdownProps`, `MarkdownSanitizer`, `CodeBlockCopy`, `CodeBlockCopyContext`, `CodeBlockCopyRenderer`, `ProviderToolsOption`, `ProviderToolsSource`, all `ChorusLabels` sub-shapes, and every provider request type (`AnthropicMessagesBody`, `AnthropicTool`, `OpenAIChatCompletionsBody`, `GeminiGenerateContentBody`, etc.).

## Message Shape

```ts
type Role = 'user' | 'assistant' | 'system' | 'tool';

interface ToolCall {
  id?: string; // provider/tool-call id when exposed by the connector
  name: string;
  input?: unknown;
  output?: unknown;
}

interface Attachment {
  name: string;
  type: string;
  data: string; // data URL by default; custom uploadAttachment may store a URL/file id here
  size: number;
  url?: string;
  id?: string;
  metadata?: Record<string, unknown>;
}

type MessageSourceType = 'url' | 'document' | 'file' | 'unknown';
interface MessageSource {
  id?: string;
  type?: MessageSourceType;
  title?: string;
  url?: string;
  snippet?: string;
  metadata?: Record<string, unknown>;
}

type MessageCitation = MessageSource;

interface MessageBase<TMeta = Record<string, unknown>> {
  id: string;
  sources?: MessageSource[]; // source/citation references rendered and persisted with the message
  metadata?: TMeta; // optional typed data (timestamps, model, latency, etc.)
}

interface UserMessage<TMeta = Record<string, unknown>> extends MessageBase<TMeta> {
  role: 'user';
  text: string; // supports CommonMark + GFM
  reasoning?: string;
  attachments?: Attachment[]; // populated by <ChatInput accept="..." />
  toolCall?: never;
}

interface AssistantMessage<TMeta = Record<string, unknown>> extends MessageBase<TMeta> {
  role: 'assistant';
  text: string;
  reasoning?: string; // optional thinking/reasoning trace rendered in a collapsed details block
  attachments?: Attachment[];
  toolCall?: never;
}

interface SystemMessage<TMeta = Record<string, unknown>> extends MessageBase<TMeta> {
  role: 'system';
  text: string;
  reasoning?: string;
  attachments?: never;
  toolCall?: never;
}

interface ToolMessage<TMeta = Record<string, unknown>> extends MessageBase<TMeta> {
  role: 'tool';
  text?: string; // optional for pure tool calls/results
  reasoning?: string;
  attachments?: never;
  toolCall: ToolCall;
}

type AnyChorusMessage<TMeta = Record<string, unknown>> =
  | UserMessage<TMeta>
  | AssistantMessage<TMeta>
  | SystemMessage<TMeta>
  | ToolMessage<TMeta>;

type Message<TMeta = Record<string, unknown>> = AnyChorusMessage<TMeta>;
```

`Message` defaults to arbitrary metadata for backwards compatibility. It is a discriminated union, so `message.role === 'tool'` narrows `message.toolCall` to a required `ToolCall`. Pass a type argument when your app stores structured metadata:

```ts
type MyMeta = {
  // ISO strings are safe with built-in JSON persistence.
  timestamp: string;
  model: string;
  latencyMs: number;
};

type ChatMessage = Message<MyMeta>;

const message: ChatMessage = {
  id: '1',
  role: 'assistant',
  text: 'Hello!',
  metadata: {
    timestamp: new Date().toISOString(),
    model: 'gpt-4o-mini',
    latencyMs: 420,
  },
};

const latency = message.metadata?.latencyMs;
```

If you enable built-in persistence, keep metadata/tool payloads/source metadata JSON-serializable or provide `serializeMessages` / `deserializeMessages`; JSON parsing does not revive `Date` instances or custom classes automatically.

```tsx
<Chorus<{ timestamp: Date }>
  persistenceKey="chat-with-dates"
  deserializeMessages={(raw) => JSON.parse(raw, (key, value) => (
    key === 'timestamp' && typeof value === 'string' ? new Date(value) : value
  ))}
/>
```

The same generic flows through public components and hooks:

```tsx
<Chorus<MyMeta>
  value={messages}
  onChange={(next) => next[0].metadata?.latencyMs}
  renderMessage={(message) => <span>{message.metadata?.model}</span>}
/>
```

The generic `Message` declaration shape is a minor semver-level type declaration change while remaining source-compatible.
