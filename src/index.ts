export { ChatWindow, MessageBubble } from './components/ChatWindow';
export type { ChatWindowProps, GetMessageFeedback, MessageBubbleProps, MessageBubbleSlots, MessageCopyResult, MessageFeedback, MessageTimestampFormatter, RenderErrorContext, RenderMessageContext, RenderMessageRootProps, MessageMarkdownProps, MessageRenderActions } from './components/ChatWindow';
export { ChatInput } from './components/ChatInput';
export type { ChatInputFocusOptions, ChatInputHandle, ChatInputProps, ChatInputSlashCommand, RenderAttachmentErrorContext } from './components/ChatInput';
export { ToolCallBlock } from './components/ToolCallBlock';
export { ConversationList } from './components/ConversationList';
export type { ConfirmDeleteConversation, ConfirmDeleteConversationContext, ConversationListProps } from './components/ConversationList';

export { Chorus } from './Chorus';
export { ChorusTheme } from './components/ChorusTheme';
export type { Palette } from './components/ChorusTheme';
export { DEFAULT_ATTACHMENT_LABELS, DEFAULT_CHORUS_LABELS, DEFAULT_SOURCE_LABELS, resolveChorusLabels } from './labels';
export type {
  ChorusAttachmentFailureContext,
  ChorusAttachmentLabels,
  ChorusAttachmentTooLargeContext,
  ChorusAttachmentTooManyContext,
  ChorusAttachmentUnsupportedTypeContext,
  ChorusCodeCopyLabels,
  ChorusComposerLabels,
  ChorusConversationListLabels,
  ChorusLabels,
  ChorusMessageActionLabels,
  ChorusSourceLabels,
  ChorusSpeakerLabels,
  ChorusToolCallLabels,
  ChorusTranscriptLabels,
  ResolvedChorusLabels,
} from './labels';
export type { ChorusAbortContext, ChorusAbortReason, ChorusAbortSource, ChorusClearConversationContext, ChorusConfirmClearConversation, ChorusConfirmDeleteMessage, ChorusConnectorOptions, ChorusDeleteMessageContext, ChorusFinishContext, ChorusMessagesChangeContext, ChorusMessagesChangeReason, ChorusMessagesChangeSource, ChorusOnAbort, ChorusOnFinish, ChorusOnSend, ChorusOnStreamDone, ChorusOnToolCall, ChorusOnToolDelta, ChorusProps, ChorusRef, ChorusSendHelpers, ChorusSendPath, ChorusShouldContinueToolLoop, ChorusStreamDoneContext, ChorusStreamDoneReason, ChorusToolCallContext, ChorusToolDeltaContext, ChorusToolHandler, ChorusToolLoopContext, ChorusToolRegistry, FetchTransportInit, McpServerConfig } from './Chorus';

export type { Message } from './types';
export type {
  Role,
  AnyChorusMessage,
  AssistantMessage,
  Attachment,
  AttachmentError,
  AttachmentErrorReason,
  AttachmentSource,
  AttachmentUploadResult,
  ConnectorName,
  MessageBlock,
  MessageCitation,
  MessageSource,
  MessageSourceType,
  StorageAdapter,
  SystemMessage,
  ToolCall,
  ToolMessage,
  UploadAttachment,
  UploadAttachmentOptions,
  UserMessage,
} from './types';
export { ChorusStreamError, useChorusStream } from './hooks/useChorusStream';
export type { SendCallbacks, StreamOptions, Transport } from './hooks/useChorusStream';
export { useChorusPersistence } from './hooks/useChorusPersistence';
export type { ChorusPersistenceError, DeserializeMessages, PersistenceOperation, PersistenceWriteOptions, SerializeMessages, UseChorusPersistenceOptions, UseChorusPersistenceResult } from './hooks/useChorusPersistence';
export { useConversations } from './hooks/useConversations';
export type { ConversationStorageError, ConversationStorageOperation, ConversationSummary, RenameFromFirstMessageOptions, UseConversationsOptions, UseConversationsResult } from './hooks/useConversations';
export { useChorusTranscriptActions, TRANSCRIPT_FORMAT_INFO } from './hooks/useChorusTranscriptActions';
export type { ChorusTranscriptActions, ChorusTranscriptActionsOptions, TranscriptExportFormat, TranscriptFormatInfo } from './hooks/useChorusTranscriptActions';
export { createFetchSSETransport } from './streaming/createFetchSSETransport';
export type { FetchSSETransportOptions } from './streaming/createFetchSSETransport';
export { createWebSocketTransport } from './streaming/createWebSocketTransport';
export type { WebSocketTransport, WebSocketTransportOptions } from './streaming/createWebSocketTransport';
export {
  formatAiSdkModelMessagesBody,
  formatAnthropicMessagesBody,
  formatGeminiGenerateContentBody,
  formatOpenAIChatCompletionsBody,
  formatOpenAIResponsesBody,
  toAiSdkModelMessages,
  toAiSdkModelMessagesBody,
  toAiSdkTools,
  toAnthropicMessages,
  toAnthropicMessagesBody,
  toAnthropicTools,
  toGeminiContents,
  toGeminiGenerateContentBody,
  toGeminiTools,
  toOpenAIChatCompletionsBody,
  toOpenAIChatCompletionsMessages,
  toOpenAIChatCompletionsTools,
  toOpenAIResponsesBody,
  toOpenAIResponsesInput,
  toOpenAIResponsesTools,
} from './providerRequests';
export type {
  AiSdkAssistantContentPart,
  AiSdkAssistantModelMessage,
  AiSdkDataContent,
  AiSdkFilePart,
  AiSdkImagePart,
  AiSdkJsonValue,
  AiSdkModelMessage,
  AiSdkModelMessagesBody,
  AiSdkModelMessagesBodyOptions,
  AiSdkReasoningPart,
  AiSdkSystemModelMessage,
  AiSdkTextPart,
  AiSdkTool,
  AiSdkToolCallPart,
  AiSdkToolModelMessage,
  AiSdkToolResultOutput,
  AiSdkToolResultPart,
  AiSdkToolSet,
  AiSdkUserContentPart,
  AiSdkUserModelMessage,
  AnthropicContentBlock,
  AnthropicDocumentBlock,
  AnthropicImageBlock,
  AnthropicMessage,
  AnthropicMessagesBody,
  AnthropicMessagesBodyOptions,
  AnthropicTextBlock,
  AnthropicTool,
  AnthropicToolResultBlock,
  AnthropicToolUseBlock,
  GeminiContent,
  GeminiFileDataPart,
  GeminiFunctionCallPart,
  GeminiFunctionDeclaration,
  GeminiFunctionResponsePart,
  GeminiGenerateContentBody,
  GeminiGenerateContentBodyOptions,
  GeminiInlineDataPart,
  GeminiPart,
  GeminiTextPart,
  GeminiToolGroup,
  OpenAIChatCompletionsAssistantMessage,
  OpenAIChatCompletionsBody,
  OpenAIChatCompletionsBodyOptions,
  OpenAIChatCompletionsImagePart,
  OpenAIChatCompletionsMessage,
  OpenAIChatCompletionsSystemMessage,
  OpenAIChatCompletionsTextPart,
  OpenAIChatCompletionsTool,
  OpenAIChatCompletionsToolCall,
  OpenAIChatCompletionsToolMessage,
  OpenAIChatCompletionsUserContentPart,
  OpenAIChatCompletionsUserMessage,
  OpenAIResponsesAssistantInputItem,
  OpenAIResponsesBody,
  OpenAIResponsesBodyOptions,
  OpenAIResponsesFunctionCallInputItem,
  OpenAIResponsesFunctionCallOutputInputItem,
  OpenAIResponsesInputContentPart,
  OpenAIResponsesInputFilePart,
  OpenAIResponsesInputImagePart,
  OpenAIResponsesInputItem,
  OpenAIResponsesInputTextPart,
  OpenAIResponsesOutputTextPart,
  OpenAIResponsesSystemInputItem,
  OpenAIResponsesTool,
  OpenAIResponsesUserInputItem,
  ProviderMappingOptions,
  ProviderToolsOption,
  ProviderToolsSource,
  UnsupportedAttachmentText,
} from './providerRequests';
export { defineTool } from './tools';
export type { ChorusToolDefinition } from './tools';
export type { McpChorusToolDefinition, McpClient, McpConnectionStatus, McpPrompt, McpResource, McpResourceAttachment, McpRuntimeSnapshot, McpServerStatus, McpSlashCommand, McpTool, McpTransportKind } from './mcp/types';
// Reserved id of the synthetic `role: 'system'` message Chorus injects into
// transport request history from the `<Chorus systemPrompt>` prop. Also exported
// from `react-chorus/server` and `react-chorus/provider-requests` for proxy/
// mapper code; see its JSDoc.
export { RESERVED_SYSTEM_PROMPT_ID, RESERVED_BLOCK_TOOL_NAME } from './reservedIds';
// `sourceDisplayLabel` mirrors the priority order the default MessageSources UI
// uses (`title || url || id || fallback`). Re-exported so custom shells that
// render their own source list can match the built-in label exactly.
export { sourceDisplayLabel } from './utils/sourceDisplayLabel';
export { Markdown } from './components/Markdown';
export type { MarkdownProps, MarkdownSanitizer, CodeBlockCopy, CodeBlockCopyContext, CodeBlockCopyRenderer } from './components/Markdown';
export { setChorusStyleNonce } from './utils/cspNonce';

// Connectors: `getConnector` (the string registry) is the single public way to
// obtain a connector. Pass a name and optional options — `getConnector('openai',
// { thinkTag })` — or hand it a custom `Connector` object. `createOpenAIConnector`
// builds an OpenAI connector object directly for callers that need one (e.g. a
// custom `onSend` client). The provider singletons (`openaiConnector` /
// `anthropicConnector` / `geminiConnector` / `aiSdkConnector`) and `autoConnector`
// are `@internal` and intentionally not re-exported from the public barrel.
export type { Connector, ConnectorResult, ConnectorToolDelta, ConnectorWarning } from './connectors/connectors';
export { getConnector } from './connectors/connectors';
export { createOpenAIConnector } from './connectors/openai';
export type { OpenAIConnectorOptions, ThinkTagSplitterOptions } from './connectors/openai';
