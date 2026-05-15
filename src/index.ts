export { ChatWindow, MessageBubble } from './components/ChatWindow';
export type { ChatWindowProps, MessageBubbleProps, MessageBubbleSlots, MessageFeedback, RenderErrorContext, RenderMessageContext, RenderMessageRootProps, MessageMarkdownProps, MessageRenderActions } from './components/ChatWindow';
export { ChatInput } from './components/ChatInput';
export type { ChatInputProps } from './components/ChatInput';
export { ToolCallBlock } from './components/ToolCallBlock';
export { ConversationList } from './components/ConversationList';
export type { ConversationListProps } from './components/ConversationList';

export { Chorus } from './Chorus';
export { ChorusTheme } from './components/ChorusTheme';
export type { Palette } from './components/ChorusTheme';
export type { ChorusAbortContext, ChorusAbortReason, ChorusAbortSource, ChorusFinishContext, ChorusMessagesChangeContext, ChorusOnAbort, ChorusOnFinish, ChorusOnSend, ChorusOnStreamDone, ChorusOnToolCall, ChorusOnToolDelta, ChorusProps, ChorusRef, ChorusSendHelpers, ChorusSendPath, ChorusShouldContinueToolLoop, ChorusStreamDoneContext, ChorusToolCallContext, ChorusToolDeltaContext, ChorusToolLoopContext, ChorusToolRegistry } from './Chorus';

export type { Message } from './types';
export type {
  Role,
  Attachment,
  AttachmentError,
  AttachmentErrorReason,
  AttachmentSource,
  AttachmentUploadResult,
  ConnectorName,
  StorageAdapter,
  ToolCall,
  UploadAttachment,
  UploadAttachmentOptions,
} from './types';
export { useChorusStream } from './hooks/useChorusStream';
export type { SendCallbacks, StreamOptions, Transport } from './hooks/useChorusStream';
export { useChorusPersistence } from './hooks/useChorusPersistence';
export type { ChorusPersistenceError, DeserializeMessages, PersistenceOperation, PersistenceWriteOptions, SerializeMessages, UseChorusPersistenceOptions, UseChorusPersistenceResult } from './hooks/useChorusPersistence';
export { useConversations } from './hooks/useConversations';
export type { ConversationStorageError, ConversationStorageOperation, ConversationSummary, RenameFromFirstMessageOptions, UseConversationsOptions, UseConversationsResult } from './hooks/useConversations';
export { createFetchSSETransport } from './streaming/createFetchSSETransport';
export type { FetchSSETransportOptions } from './streaming/createFetchSSETransport';
export { createWebSocketTransport } from './streaming/createWebSocketTransport';
export type { WebSocketTransportOptions } from './streaming/createWebSocketTransport';
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
export { openaiConnector } from './connectors/openai';
export { anthropicConnector } from './connectors/anthropic';
export { geminiConnector } from './connectors/gemini';
