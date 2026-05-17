export { ChatWindow, MessageBubble } from './components/ChatWindow';
export type { ChatWindowProps, GetMessageFeedback, MessageBubbleProps, MessageBubbleSlots, MessageCopyResult, MessageFeedback, RenderErrorContext, RenderMessageContext, RenderMessageRootProps, MessageMarkdownProps, MessageRenderActions } from './components/ChatWindow';
export { ChatInput } from './components/ChatInput';
export type { ChatInputProps } from './components/ChatInput';
export { ToolCallBlock } from './components/ToolCallBlock';
export { ConversationList } from './components/ConversationList';
export type { ConfirmDeleteConversation, ConfirmDeleteConversationContext, ConversationListProps } from './components/ConversationList';

export { Chorus } from './Chorus';
export { ChorusTheme } from './components/ChorusTheme';
export type { Palette } from './components/ChorusTheme';
export { DEFAULT_CHORUS_LABELS, resolveChorusLabels } from './labels';
export type {
  ChorusCodeCopyLabels,
  ChorusComposerLabels,
  ChorusConversationListLabels,
  ChorusLabels,
  ChorusMessageActionLabels,
  ChorusSpeakerLabels,
  ChorusToolCallLabels,
  ChorusTranscriptLabels,
  ResolvedChorusLabels,
} from './labels';
export type { ChorusAbortContext, ChorusAbortReason, ChorusAbortSource, ChorusClearConversationContext, ChorusConfirmClearConversation, ChorusConfirmDeleteMessage, ChorusDeleteMessageContext, ChorusFinishContext, ChorusMessagesChangeContext, ChorusOnAbort, ChorusOnFinish, ChorusOnSend, ChorusOnStreamDone, ChorusOnToolCall, ChorusOnToolDelta, ChorusProps, ChorusRef, ChorusSendHelpers, ChorusSendPath, ChorusShouldContinueToolLoop, ChorusStreamDoneContext, ChorusToolCallContext, ChorusToolDeltaContext, ChorusToolLoopContext, ChorusToolRegistry, FetchTransportInit } from './Chorus';

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
export { createFetchSSETransport } from './streaming/createFetchSSETransport';
export type { FetchSSETransportOptions } from './streaming/createFetchSSETransport';
export { createWebSocketTransport } from './streaming/createWebSocketTransport';
export type { WebSocketTransport, WebSocketTransportOptions } from './streaming/createWebSocketTransport';
export {
  formatAnthropicMessagesBody,
  formatGeminiGenerateContentBody,
  formatOpenAIChatCompletionsBody,
  formatOpenAIResponsesBody,
  toAnthropicMessages,
  toAnthropicMessagesBody,
  toGeminiContents,
  toGeminiGenerateContentBody,
  toOpenAIChatCompletionsBody,
  toOpenAIChatCompletionsMessages,
  toOpenAIResponsesBody,
  toOpenAIResponsesInput,
} from './providerRequests';
export type {
  AnthropicMessage,
  AnthropicMessagesBody,
  AnthropicMessagesBodyOptions,
  GeminiContent,
  GeminiGenerateContentBody,
  GeminiGenerateContentBodyOptions,
  OpenAIChatCompletionsBody,
  OpenAIChatCompletionsBodyOptions,
  OpenAIChatCompletionsMessage,
  OpenAIResponsesBody,
  OpenAIResponsesBodyOptions,
  OpenAIResponsesInputItem,
  ProviderMappingOptions,
  UnsupportedAttachmentText,
} from './providerRequests';
export { Markdown } from './components/Markdown';
export type { MarkdownProps, MarkdownSanitizer } from './components/Markdown';

export type { Connector, ConnectorResult, ConnectorToolDelta } from './connectors/connectors';
export { getConnector, autoConnector } from './connectors/connectors';
export { openaiConnector, createOpenAIConnector } from './connectors/openai';
export type { OpenAIConnectorOptions, ThinkTagSplitterOptions } from './connectors/openai';
export { anthropicConnector } from './connectors/anthropic';
export { geminiConnector } from './connectors/gemini';
