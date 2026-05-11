// react-chorus/headless — all components with zero default styles.
// CSS class names are preserved as semantic hooks for consumer styling.
// No stylesheets are imported; Markdown renders plain HTML without
// injecting any <style> tags.

export { ChatWindow } from './components/ChatWindow';
export { ChatInput } from './components/ChatInput';
export type { ChatInputProps } from './components/ChatInput';

export { ChorusHeadless as Chorus } from './ChorusHeadless';
export type { ChorusHeadlessProps as ChorusProps } from './ChorusHeadless';
export { ChorusHeadless } from './ChorusHeadless';
export type { ChorusHeadlessProps } from './ChorusHeadless';

export { ChorusTheme } from './components/ChorusTheme';
export type { Palette } from './components/ChorusTheme';

export type { Message, Role } from './types';
export { useChorusStream } from './hooks/useChorusStream';
export { createFetchSSETransport } from './streaming/createFetchSSETransport';
export { Markdown } from './components/Markdown';

export type { Connector, ConnectorResult } from './connectors/connectors';
export { getConnector, autoConnector } from './connectors/connectors';
export { openaiConnector } from './connectors/openai';
