export { ChatWindow } from './components/ChatWindow';
export { ChatInput } from './components/ChatInput';
export type { ChatInputProps } from './components/ChatInput';

export { Chorus } from './Chorus';
export { ChorusTheme } from './components/ChorusTheme';
export type { Palette } from './components/ChorusTheme';
export type { ChorusProps } from './Chorus';

export type { Message, Role } from './types';
export { useChorusStream } from './hooks/useChorusStream';
export type { Transport } from './hooks/useChorusStream';
export { createFetchSSETransport } from './streaming/createFetchSSETransport';
export { Markdown } from './components/Markdown';

export type { Connector, ConnectorResult } from './connectors/connectors';
export { getConnector, autoConnector } from './connectors/connectors';
export { openaiConnector } from './connectors/openai';
