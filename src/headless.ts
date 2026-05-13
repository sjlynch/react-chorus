// react-chorus/headless — all components with zero default styles.
// CSS class names are preserved as semantic hooks for consumer styling.
// No stylesheets are imported; Markdown renders plain HTML without
// injecting any <style> tags.

export { ChatWindow, MessageBubble } from './components/ChatWindow';
export type { ChatWindowProps, MessageBubbleProps } from './components/ChatWindow';
export { ChatInput } from './components/ChatInput';
export type { ChatInputProps } from './components/ChatInput';
export { ToolCallBlock } from './components/ToolCallBlock';

// ChorusHeadless is Chorus with headless defaulting to true.
export { ChorusHeadless as Chorus, type ChorusHeadlessProps as ChorusProps } from './ChorusHeadless';
export { ChorusHeadless } from './ChorusHeadless';
export type { ChorusHeadlessProps } from './ChorusHeadless';
export type { ChorusOnSend, ChorusSendHelpers } from './Chorus';

export { ChorusTheme } from './components/ChorusTheme';
export type { Palette } from './components/ChorusTheme';

export type { Message } from './types';
export type { Role, Attachment, ConnectorName, StorageAdapter, ToolCall } from './types';
export { useChorusStream } from './hooks/useChorusStream';
export type { SendCallbacks, StreamOptions, Transport } from './hooks/useChorusStream';
export { useChorusPersistence } from './hooks/useChorusPersistence';
export { createFetchSSETransport } from './streaming/createFetchSSETransport';
export type { FetchSSETransportOptions } from './streaming/createFetchSSETransport';
export { createWebSocketTransport } from './streaming/createWebSocketTransport';
export type { WebSocketTransportOptions } from './streaming/createWebSocketTransport';
export { Markdown } from './components/Markdown';
export type { MarkdownProps, MarkdownSanitizer } from './components/Markdown';

export type { Connector, ConnectorResult } from './connectors/connectors';
export { getConnector, autoConnector } from './connectors/connectors';
export { openaiConnector } from './connectors/openai';
export { anthropicConnector } from './connectors/anthropic';
export { geminiConnector } from './connectors/gemini';
