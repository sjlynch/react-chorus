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
export type { ChorusAbortContext, ChorusAbortReason, ChorusAbortSource, ChorusConfirmDeleteMessage, ChorusDeleteMessageContext, ChorusFinishContext, ChorusMessagesChangeContext, ChorusOnAbort, ChorusOnFinish, ChorusOnSend, ChorusOnStreamDone, ChorusOnToolCall, ChorusOnToolDelta, ChorusProps, ChorusRef, ChorusSendHelpers, ChorusSendPath, ChorusShouldContinueToolLoop, ChorusStreamDoneContext, ChorusToolCallContext, ChorusToolDeltaContext, ChorusToolLoopContext, ChorusToolRegistry } from './Chorus';

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
  AnthropicMessage,
  AnthropicMessagesBody,
  AnthropicMessagesBodyOptions,
  AnthropicTool,
  GeminiContent,
  GeminiFunctionDeclaration,
  GeminiGenerateContentBody,
  GeminiGenerateContentBodyOptions,
  GeminiToolGroup,
  OpenAIChatCompletionsBody,
  OpenAIChatCompletionsBodyOptions,
  OpenAIChatCompletionsMessage,
  OpenAIChatCompletionsTool,
  OpenAIResponsesBody,
  OpenAIResponsesBodyOptions,
  OpenAIResponsesInputItem,
  OpenAIResponsesTool,
  ProviderMappingOptions,
  ProviderToolsOption,
  ProviderToolsSource,
  UnsupportedAttachmentText,
} from './providerRequests';
export { defineTool } from './tools';
export type { ChorusToolDefinition } from './tools';
export { Markdown } from './components/Markdown';
export type { MarkdownProps, MarkdownSanitizer } from './components/Markdown';

export type { Connector, ConnectorResult, ConnectorToolDelta } from './connectors/connectors';
export { getConnector, autoConnector } from './connectors/connectors';
export { openaiConnector } from './connectors/openai';
export { anthropicConnector } from './connectors/anthropic';
export { geminiConnector } from './connectors/gemini';
