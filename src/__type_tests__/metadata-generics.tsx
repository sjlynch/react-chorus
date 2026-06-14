import type { RefObject } from 'react';
import { ChatWindow, Chorus, MessageBubble, createFetchSSETransport, createWebSocketTransport, useChorusPersistence, useChorusStream } from '../index';
import type { ChorusFinalizeAssistantOptions, ChorusOnAbort, ChorusOnSend, ChorusRef, ChorusSendHelpers, Message, Transport } from '../index';
import type {
  AttachmentError as HeadlessAttachmentError,
  AttachmentErrorReason as HeadlessAttachmentErrorReason,
  AttachmentSource as HeadlessAttachmentSource,
  AttachmentUploadResult as HeadlessAttachmentUploadResult,
  ChorusOnAbort as HeadlessChorusOnAbort,
  ChorusOnSend as HeadlessChorusOnSend,
  ChorusSendHelpers as HeadlessChorusSendHelpers,
  UploadAttachment as HeadlessUploadAttachment,
} from '../headless';

interface MyMeta {
  latencyMs: number;
  model?: string;
}

const typedMessages: Message<MyMeta>[] = [
  { id: '1', role: 'user', text: 'Hello', metadata: { latencyMs: 12, model: 'gpt-4o-mini' } },
];

const typedTransport: Transport<MyMeta> = async (_text, history) => {
  const latency: number | undefined = history[0]?.metadata?.latencyMs;
  // @ts-expect-error MyMeta does not include tokenCount
  void history[0]?.metadata?.tokenCount;
  return new Response(`data: ${latency ?? 0}\n\n`);
};

export const typedChorusElement = (
  <Chorus<MyMeta>
    value={typedMessages}
    onChange={(next) => {
      const latency: number | undefined = next[0]?.metadata?.latencyMs;
      // @ts-expect-error MyMeta does not include costUsd
      void next[0]?.metadata?.costUsd;
      void latency;
    }}
    transport={typedTransport}
    onMessagesChange={(next, context) => {
      const latency: number | undefined = next[0]?.metadata?.latencyMs;
      const source: 'controlled' | 'uncontrolled' | 'persistence' = context.source;
      void latency;
      void source;
    }}
    onAbort={(context) => {
      const latency: number | undefined = context.message?.metadata?.latencyMs;
      const path: 'transport' | 'onSend' = context.path;
      void latency;
      void path;
      // @ts-expect-error MyMeta does not include abortTraceId
      void context.message?.metadata?.abortTraceId;
    }}
    getMessageFeedback={(message) => {
      const model: string | undefined = message.metadata?.model;
      // @ts-expect-error MyMeta does not include reviewState
      void message.metadata?.reviewState;
      return model ? 'up' : null;
    }}
    renderMessage={(message, ctx) => {
      const model: string | undefined = message.metadata?.model;
      // @ts-expect-error MyMeta does not include traceId
      void message.metadata?.traceId;
      return <span {...ctx.messageProps}>{model}</span>;
    }}
  />
);

const fetchTransport = createFetchSSETransport<MyMeta>('/api/chat', {
  headers: { 'Content-Type': 'application/json' },
  formatBody: (_text, history) => JSON.stringify({ latency: history[0]?.metadata?.latencyMs }),
});

const webSocketTransport = createWebSocketTransport<MyMeta>('wss://api.example.com/chat', {
  persistent: true,
  onMessage: (_data, _event) => undefined,
  formatMessage: (_text, history) => JSON.stringify({ latency: history[0]?.metadata?.latencyMs }),
});
webSocketTransport.close();

const typedRef = { current: null } as RefObject<ChorusRef<MyMeta> | null>;
const typedRefMessages: Message<MyMeta>[] | undefined = typedRef.current?.getMessages();
const typedRefScrolled: boolean | undefined = typedRef.current?.scrollToMessage('1');
void typedRefMessages;
void typedRefScrolled;

const typedHelpers: ChorusSendHelpers = {
  appendAssistant: (_chunk) => undefined,
  finalizeAssistant: () => undefined,
  signal: new AbortController().signal,
};

const typedOnSend: ChorusOnSend<MyMeta> = async (_text, history, helpers) => {
  const latency: number | undefined = history[0]?.metadata?.latencyMs;
  // @ts-expect-error MyMeta does not include requestId
  void history[0]?.metadata?.requestId;
  helpers.appendAssistant(String(latency ?? 0));
};

// The documented cost-meter `onSend` recipe must keep typechecking against the
// public `ChorusSendHelpers` contract so the docs cannot drift from the code.
const costMeterOnSend: ChorusOnSend = (_text, _messages, helpers) => {
  helpers.finalizeAssistant(); // no-arg form still valid
  helpers.finalizeAssistant({
    text: 'reply',
    metadata: { modelId: 'gpt-4o', usage: { input_tokens: 1, output_tokens: 2 } },
  });
  const finalizeOptions: ChorusFinalizeAssistantOptions = {
    metadata: { usage: { prompt_tokens: 1, completion_tokens: 2 } },
  };
  helpers.finalizeAssistant(finalizeOptions);
  // @ts-expect-error finalizeAssistant takes an options object, not a positional string
  helpers.finalizeAssistant('not options');
};
void costMeterOnSend;

const typedOnAbort: ChorusOnAbort<MyMeta> = (context) => {
  const model: string | undefined = context.message?.metadata?.model;
  void model;
};
const headlessOnAbort: HeadlessChorusOnAbort<MyMeta> = typedOnAbort;
const headlessOnSend: HeadlessChorusOnSend<MyMeta> = typedOnSend;
const headlessHelpers: HeadlessChorusSendHelpers = typedHelpers;
const headlessUpload: HeadlessUploadAttachment = async (file) => ({ name: file.name, type: file.type, size: file.size, data: 'data:' });
const headlessUploadResult: HeadlessAttachmentUploadResult = { name: 'x', type: 'text/plain', size: 1, data: 'data:' };
const headlessAttachmentReason: HeadlessAttachmentErrorReason = 'upload-failed';
const headlessAttachmentSource: HeadlessAttachmentSource = 'drop';
const headlessAttachmentError: HeadlessAttachmentError = {
  reason: headlessAttachmentReason,
  source: headlessAttachmentSource,
  message: 'failed',
};
void headlessOnAbort;
void headlessOnSend;
void headlessHelpers;
void headlessUpload;
void headlessUploadResult;
void headlessAttachmentError;

function HookSamples() {
  const persist = useChorusPersistence<MyMeta>('chat');
  const stream = useChorusStream<MyMeta>(fetchTransport);
  const socketStream = useChorusStream<MyMeta>(webSocketTransport);
  void stream.sending;
  void socketStream.sending;

  return (
    <ChatWindow<MyMeta>
      messages={persist.value}
      renderMessage={(message) => <MessageBubble<MyMeta> message={message} />}
    />
  );
}

export const hookSamplesElement = <HookSamples />;

const untypedMessages: Message[] = [
  { id: 'untyped', role: 'assistant', text: 'Untyped users still work', metadata: { arbitrary: 1 } },
];

export const untypedChorusElement = (
  <Chorus
    value={untypedMessages}
    onChange={(next) => {
      void next[0]?.metadata?.arbitrary;
    }}
    renderMessage={(message) => {
      void message.metadata?.arbitrary;
      return null;
    }}
  />
);
