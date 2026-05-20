# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project uses semantic versioning.

## [Unreleased]

### Added

#### Connectors / streaming
- Added the `'ai-sdk'` connector for the [Vercel AI SDK](./README.md#vercel-ai-sdk-stream-format). It parses both stream shapes the SDK can emit: the SSE-formatted **UI message stream** (`toUIMessageStreamResponse()`, AI SDK v5+) with `text-delta`, `reasoning-delta`, and `tool-input-*` / `tool-output-*` JSON events, and the prefix-coded **data-stream protocol** (`toDataStreamResponse()`, AI SDK v4) with `0:` / `g:` / `9:` / `c:` / `a:` text, reasoning, and tool frames plus `d:`/`e:` finish frames. `error` / `3:` frames surface through the in-band error path, and protocol/lifecycle frames are silently ignored.
- Extended `autoConnector` frame detection to recognize Vercel AI SDK UI-message-stream JSON and data-stream prefix lines, so AI SDK routes work under the default `connector="auto"`.
- Exported `createOpenAIConnector`, a factory for OpenAI connectors with a configurable, case-insensitive `<think>` reasoning splitter (`thinkTag` option), along with the `OpenAIConnectorOptions` and `ThinkTagSplitterOptions` types.
- Exported `aiSdkConnector` and `createOpenAIConnector`, bringing the built-in connector exports to `getConnector`, `autoConnector`, `openaiConnector`, `createOpenAIConnector`, `anthropicConnector`, `geminiConnector`, and `aiSdkConnector`.

### Deprecation candidates (future major)
- The default transport body `{ prompt, history }` duplicates the latest user turn — `prompt` equals `history[history.length - 1].text`. Backends already consume `history` only (see all `examples/` proxies). A future major release should drop `prompt` from `createFetchSSETransport`, `createWebSocketTransport`, and `createDefaultFetchSSETransport` defaults and send `{ history }` exclusively. Until then, README and JSDoc warn against re-appending `prompt` server-side. See [README → Migration and Upgrading → Default transport body will drop the `prompt` field](./README.md#default-transport-body-will-drop-the-prompt-field) for the concrete migration path.

## [0.2.0] - 2026-05-15

### Added

#### Tool agent loop
- Added a `tools` registry prop and `ChorusToolRegistry` type for declaring client-side tool implementations.
- Added `autoContinueTools`, `maxToolIterations`, and `shouldContinueToolLoop` props for controlling automatic tool-call → result → resume cycles.
- Added `onToolCall`, `onToolDelta`, `onStreamDone`, and `onAbort` callbacks with `ChorusToolCallContext`, `ChorusToolDeltaContext`, `ChorusToolLoopContext`, `ChorusStreamDoneContext`, and `ChorusAbortContext` payload types.

#### Multi-conversation
- Added the `useConversations` hook and `<ConversationList>` component for listing, switching, renaming, and deleting saved conversations.
- Added `ConversationSummary`, `UseConversationsOptions`, `UseConversationsResult`, `ConversationStorageError`, `ConversationStorageOperation`, and `RenameFromFirstMessageOptions` types.
- Added `confirmDeleteConversation` (with `ConfirmDeleteConversation`/`ConfirmDeleteConversationContext`) for custom delete-confirmation UX.

#### Composer / UX
- Added `disabled`, `disabledReason`, and `readOnly` props for locking the composer and disabling message actions.
- Added `resetToInitialMessages` for restoring the seeded message list and `confirmDeleteMessage` (with `ChorusConfirmDeleteMessage`/`ChorusDeleteMessageContext`) for delete-confirmation UX.
- Added `suggestedPrompts`, `showJumpToBottomButton`, and `systemPrompt` props.
- Added `getMessageFeedback`/`onFeedback` (with `GetMessageFeedback`/`MessageFeedback` types) for per-message thumbs-up/down feedback.
- Added `maxRenderedMessages`, `renderError`, `renderMessage`, `markdownProps`, and `markdownSanitizer` props with `RenderErrorContext`, `RenderMessageContext`, `RenderMessageRootProps`, `MessageMarkdownProps`, and `MessageRenderActions` types.

#### Persistence
- Added `onPersistenceError`, `deserializeMessages`, `serializeMessages`, and `PersistenceWriteOptions` for richer custom storage adapters.
- Added `flush` on `useChorusPersistence` for forcing pending writes (with `ChorusPersistenceError`, `PersistenceOperation`, `DeserializeMessages`, `SerializeMessages`, `UseChorusPersistenceOptions`, `UseChorusPersistenceResult` types).
- `StorageAdapter` now supports async loading; pending loads are awaited before send/persist.

#### Provider helpers (new `react-chorus/provider-requests` subpath)
- Added `formatOpenAIChatCompletionsBody`, `formatOpenAIResponsesBody`, and `toOpenAIResponsesInput` for OpenAI request bodies.
- Added `formatAnthropicMessagesBody`, `toAnthropicMessagesBody`, and `toAnthropicMessages` for Anthropic Messages request bodies.
- Added `formatGeminiGenerateContentBody`, `toGeminiContents`, and `toGeminiGenerateContentBody` for Gemini GenerateContent request bodies.
- Added `ProviderMappingOptions` and `UnsupportedAttachmentText` for cross-provider mapping config, plus per-provider body/option/message types (`OpenAIChatCompletionsBody`/`Options`/`Message`, `OpenAIResponsesBody`/`Options`/`InputItem`, `AnthropicMessage`/`MessagesBody`/`MessagesBodyOptions`, `GeminiContent`/`GenerateContentBody`/`GenerateContentBodyOptions`).
- Exported the same helpers from the root entry, with the dedicated `react-chorus/provider-requests` subpath available for consumers who want to import only the mappers.

#### Transports (new `react-chorus/transport` subpath)
- Added `createWebSocketTransport` with persistent-WebSocket mode and `WebSocketTransport`/`WebSocketTransportOptions` types.
- Added `onOpen`/`onClose`/`onError`/`onMessage` lifecycle callbacks and `formatBody`/`formatMessage` options on the SSE and WS transports.
- Added the `react-chorus/transport` subpath re-exporting `createFetchSSETransport`, `createWebSocketTransport`, and the `Transport` type for transport-only consumers.

#### Connectors / streaming
- Made `Connector<State>` generic with optional `createState`/`flush` hooks so connectors can carry per-stream state.
- Added in-band error parsing across connectors so provider error frames surface as `ChorusStreamError` instead of silently ending the stream.
- Added richer OpenAI Responses event coverage and Gemini blocked-finish-reason errors.
- Added `<think>` tag splitting so chain-of-thought output renders separately from the visible answer.
- Added `provider`, `providerId`, and `generated` fields to `ConnectorToolDelta` so connectors can report provider-issued tool-call IDs.
- Exported `autoConnector`, `getConnector`, `openaiConnector`, `anthropicConnector`, and `geminiConnector`.

#### Markdown
- Exported the standalone `Markdown` component with `MarkdownProps` and `MarkdownSanitizer` types.
- Added configurable `markedOptions`, `markedExtensions`, and sanitizer override for the Markdown pipeline.

### Changed
- Bumped the package to `0.2.0` for a public message typing refinement.
- Replaced the public `Message` shape with a discriminated union (`AnyChorusMessage`) so `role: 'tool'` requires `toolCall`, non-tool messages forbid it, and tool/system messages reject attachments.
- Extracted Chorus send/session orchestration into `useAssistantSession` and clarified controlled, transport, connector, and sending-state development warnings.
- `useChorusStream.send()` now rejects non-abort stream failures after cleanup so `onSend` bridges can surface Chorus errors.
- `useChorusStream.send()` now rejects with a `ChorusStreamError` whose `code === 'concurrent-send'` when called while a previous send is still in flight, instead of silently resolving with `undefined`. The transport is still not invoked a second time and the dev-mode warning is preserved; custom shells that `await send(...)` can now distinguish the re-entrant no-op from a successful empty stream.
- Documented keyboard shortcuts, standalone `useChorusStream`, persistence examples, error handling, and OpenAI proxy buffering headers.

### Fixed
- Fixed stream cleanup on unmount/pre-aborted signals, richer HTTP error details, WebSocket close-before-open hangs, safe dev-mode checks without `process`, observer callback isolation, and transport concurrency guards.

## [0.1.0] - 2026-05-11

### Added
- Initial public release: the batteries-included `<Chorus>` chat component coordinating message rendering, the composer, streaming, persistence, and theming, with a stable `ChorusProps` contract.
- `react-chorus/headless` entry and the `headless` prop for unstyled, bring-your-own-CSS usage.
- Component pieces for custom shells: `ChatWindow`, `MessageBubble`, `ChatInput`, `ToolCallBlock`, `ChorusTheme`, and `Markdown`.
- The `Message` type with `Role`, `Attachment`, `ToolCall`, and `StorageAdapter`, including an optional generic `metadata` field and `system` / `tool` message roles.
- SSE streaming via the `transport` prop, with the `createFetchSSETransport` and `createWebSocketTransport` factories and the standalone `useChorusStream` hook.
- Provider connectors with auto-detection: `getConnector`, `autoConnector`, `openaiConnector`, and `anthropicConnector` for parsing OpenAI and Anthropic (Claude) SSE streams.
- Markdown rendering with fenced code blocks, lazy-loaded `highlight.js` syntax highlighting, and copy-to-clipboard buttons.
- Conversation persistence through the `useChorusPersistence` hook and `persistenceKey` prop, backed by `localStorage` or a pluggable `StorageAdapter`.
- Error-state UI with retry support.
- Message actions: edit a sent message, regenerate a response, and delete messages.
- File and image attachment support in `ChatInput`.
- Tool call / agent step rendering via `ToolCallBlock`, plus the `renderMessage` render prop and `MessageBubble` for custom message rendering.
- Theming through `ChorusTheme` and the `Palette` type.
