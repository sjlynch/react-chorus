import { createElement, type ComponentProps } from 'react';
import { Chorus } from 'react-chorus';
import { ChorusHeadless } from 'react-chorus/headless';
import { createFetchSSETransport } from 'react-chorus/transport';
import 'react-chorus/styles.css';

const props = {
  initialMessages: [{ id: 'welcome', role: 'assistant' as const, text: 'Hello from Chorus.' }],
} satisfies ComponentProps<typeof Chorus>;

export const rootChorus = createElement(Chorus, props);
export const headlessChorus = createElement(ChorusHeadless, props);
export const transport = createFetchSSETransport('/api/chat');
