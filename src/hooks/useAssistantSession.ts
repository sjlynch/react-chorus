import React from 'react';
import type { Attachment, ConnectorName, Message } from '../types';
import type { Connector, ConnectorToolDelta } from '../connectors/connectors';
import { useChorusStream, type SendCallbacks, type Transport } from './useChorusStream';
import { createFetchSSETransport } from '../streaming/createFetchSSETransport';
import { useRAFQueue } from './useRAFQueue';
import { useLatestRef } from './useLatestRef';
import { isChorusDevMode } from '../utils/devMode';

export interface ChorusSendHelpers {
  appendAssistant: (chunk: string) => void;
  appendReasoning?: (chunk: string) => void;
  appendToolDelta?: (delta: ConnectorToolDelta) => void;
  finalizeAssistant: () => void;
  /** Complete callback set for bridging `useChorusStream(...).send()` through `onSend`. */
  streamCallbacks?: () => SendCallbacks;
  signal: AbortSignal;
  /** The optional `systemPrompt` prop. Use it in custom `onSend` request mapping; it is not prepended to `messages` on the onSend path. */
  systemPrompt?: string;
}

export type ChorusOnSend<TMeta = Record<string, unknown>> = (
  text: string,
  messages: Message<TMeta>[],
  helpers: ChorusSendHelpers,
) => Promise<Message<TMeta> | void> | Message<TMeta> | void;

export interface ChorusFinishContext<TMeta = Record<string, unknown>> {
  message: Message<TMeta>;
  messages: Message<TMeta>[];
  reason: 'done' | 'returned-message';
  response?: Response;
}

export type ChorusOnFinish<TMeta = Record<string, unknown>> = (context: ChorusFinishContext<TMeta>) => void;

export interface ChorusToolDeltaContext<TMeta = Record<string, unknown>> {
  delta: ConnectorToolDelta;
  message: Message<TMeta>;
  messages: Message<TMeta>[];
}

export type ChorusOnToolDelta<TMeta = Record<string, unknown>> = (context: ChorusToolDeltaContext<TMeta>) => void;

export interface ChorusToolCallContext<TMeta = Record<string, unknown>> {
  id: string;
  name: string;
  input?: unknown;
  output?: unknown;
  message: Message<TMeta>;
  messages: Message<TMeta>[];
  signal: AbortSignal;
}

export type ChorusOnToolCall<TMeta = Record<string, unknown>> = (context: ChorusToolCallContext<TMeta>) => unknown | Promise<unknown>;
export type ChorusToolHandler<TMeta = Record<string, unknown>> = (input: unknown, context: ChorusToolCallContext<TMeta>) => unknown | Promise<unknown>;
export type ChorusToolRegistry<TMeta = Record<string, unknown>> = Record<string, ChorusToolHandler<TMeta>>;

export interface ChorusStreamDoneContext<TMeta = Record<string, unknown>> {
  assistantMessage: Message<TMeta> | null;
  toolMessages: Message<TMeta>[];
  messages: Message<TMeta>[];
  response?: Response;
}

export type ChorusOnStreamDone<TMeta = Record<string, unknown>> = (context: ChorusStreamDoneContext<TMeta>) => void;

export interface ChorusToolLoopContext<TMeta = Record<string, unknown>> extends ChorusStreamDoneContext<TMeta> {
  /** Number of completed tool-execution iterations, starting at 1 for the first continuation. */
  iteration: number;
  maxToolIterations: number;
  signal: AbortSignal;
}

export type ChorusShouldContinueToolLoop<TMeta = Record<string, unknown>> = (context: ChorusToolLoopContext<TMeta>) => boolean | Promise<boolean>;

interface UpdateMessagesOptions {
  flushPersistence?: boolean;
  removePersistenceIfEmpty?: boolean;
  reason?: 'send' | 'assistant' | 'retry' | 'edit' | 'regenerate' | 'delete' | 'clear' | 'update';
}

interface SubmittedUserTurn<TMeta = Record<string, unknown>> {
  text: string;
  history: Message<TMeta>[];
}

export interface UseAssistantSessionOptions<TMeta = Record<string, unknown>> {
  messages: Message<TMeta>[];
  updateMessages: (updater: (prev: Message<TMeta>[]) => Message<TMeta>[], options?: UpdateMessagesOptions) => Message<TMeta>[];
  seedMessages: Message<TMeta>[];
  transport?: string | Transport<TMeta>;
  systemPrompt?: string;
  connector?: Connector | ConnectorName;
  onSend?: ChorusOnSend<TMeta>;
  minAssistantDelayMs: number;
  fallbackErrorMessage: string;
  onError?: (error: Error) => void;
  onChunkRef: React.MutableRefObject<((chunk: string, messageId: string) => void) | undefined>;
  onFinish?: ChorusOnFinish<TMeta>;
  onStreamDone?: ChorusOnStreamDone<TMeta>;
  onToolCall?: ChorusOnToolCall<TMeta>;
  onToolDelta?: ChorusOnToolDelta<TMeta>;
  tools?: ChorusToolRegistry<TMeta>;
  autoContinueTools?: boolean;
  maxToolIterations?: number;
  shouldContinueToolLoop?: ChorusShouldContinueToolLoop<TMeta>;
  flushPersistence: () => void;
  resetToInitialMessages?: boolean;
  onClear?: (messages: Message<TMeta>[]) => void;
}

export interface UseAssistantSessionResult {
  send: (text: string, attachments?: Attachment[]) => boolean;
  retry: () => void;
  stop: () => void;
  clear: () => void;
  dismissError: () => void;
  handleEdit: (id: string, newText: string) => void;
  handleRegenerate: (id: string) => void;
  handleDelete: (id: string) => void;
  sending: boolean;
  streamError: string | null;
  streamRawError: Error | null;
  streamingMessageId: string | null;
  hasStartedAssistant: boolean;
}

const DEFAULT_MAX_TOOL_ITERATIONS = 4;

let fallbackMessageIdCounter = 0;

function createMessageId() {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto);

  fallbackMessageIdCounter += 1;
  return `chorus-${Date.now()}-${fallbackMessageIdCounter}`;
}

function dropTrailingAssistant<TMeta>(history: Message<TMeta>[]) {
  const last = history[history.length - 1];
  return last?.role === 'assistant' ? history.slice(0, -1) : history;
}

function isAbortError(error: unknown) {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

function createAbortError() {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) return error as Error;
  return new Error(String(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function metadataWithToolProvider<TMeta>(existing: TMeta | undefined, delta: ConnectorToolDelta): TMeta | undefined {
  if (!delta.providerId) return existing;

  const metadata: Record<string, unknown> = isRecord(existing) ? { ...existing } : {};
  if (delta.provider === 'openai') {
    const openai = isRecord(metadata.openai) ? { ...metadata.openai } : {};
    openai.toolCallId = delta.providerId;
    openai.callId = delta.providerId;
    metadata.openai = openai;
  } else if (delta.provider === 'anthropic') {
    const anthropic = isRecord(metadata.anthropic) ? { ...metadata.anthropic } : {};
    anthropic.toolUseId = delta.providerId;
    metadata.anthropic = anthropic;
  }

  return Object.keys(metadata).length ? metadata as TMeta : existing;
}

function hasToolOutput<TMeta>(message: Message<TMeta>) {
  return Boolean(message.toolCall && Object.prototype.hasOwnProperty.call(message.toolCall, 'output'));
}

function cloneMessageForRetry<TMeta>(message: Message<TMeta>): Message<TMeta> {
  return {
    ...message,
    attachments: message.attachments?.map(attachment => ({ ...attachment })),
  };
}

function cloneHistoryForRetry<TMeta>(history: Message<TMeta>[]): Message<TMeta>[] {
  return history.map(message => cloneMessageForRetry(message));
}

function findLastUserMessage<TMeta>(history: Message<TMeta>[]) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].role === 'user') return history[i];
  }
  return null;
}

function warnObserverError(callbackName: string, error: unknown) {
  if (!isChorusDevMode()) return;
  console.warn(`[Chorus] \`${callbackName}\` callback threw and was ignored so it could not interrupt message rendering.`, error);
}

export function useAssistantSession<TMeta = Record<string, unknown>>({
  messages,
  updateMessages,
  seedMessages,
  transport,
  systemPrompt,
  connector,
  onSend,
  minAssistantDelayMs,
  fallbackErrorMessage,
  onError,
  onChunkRef,
  onFinish,
  onStreamDone,
  onToolCall,
  onToolDelta,
  tools,
  autoContinueTools = false,
  maxToolIterations = DEFAULT_MAX_TOOL_ITERATIONS,
  shouldContinueToolLoop,
  flushPersistence,
  resetToInitialMessages = false,
  onClear,
}: UseAssistantSessionOptions<TMeta>): UseAssistantSessionResult {
  const messagesRef = useLatestRef(messages);
  const transportRef = useLatestRef(transport);
  const onSendRef = useLatestRef(onSend);
  const onErrorRef = useLatestRef(onError);
  const onFinishRef = useLatestRef(onFinish);
  const onStreamDoneRef = useLatestRef(onStreamDone);
  const onToolCallRef = useLatestRef(onToolCall);
  const onToolDeltaRef = useLatestRef(onToolDelta);
  const toolsRef = useLatestRef(tools);
  const autoContinueToolsRef = useLatestRef(autoContinueTools);
  const maxToolIterationsRef = useLatestRef(maxToolIterations);
  const shouldContinueToolLoopRef = useLatestRef(shouldContinueToolLoop);
  const onClearRef = useLatestRef(onClear);
  const fallbackErrorMessageRef = useLatestRef(fallbackErrorMessage);
  const systemPromptRef = useLatestRef(systemPrompt);
  const minAssistantDelayMsRef = useLatestRef(minAssistantDelayMs);
  const seedMessagesRef = useLatestRef(seedMessages);

  const [internalSending, setInternalSendingState] = React.useState(false);
  const [transportBusy, setTransportBusyState] = React.useState(false);
  const [streamError, setStreamError] = React.useState<string | null>(null);
  const [streamRawError, setStreamRawError] = React.useState<Error | null>(null);
  const [, forceRender] = React.useReducer((value: number) => value + 1, 0);

  const clearStreamError = React.useCallback(() => {
    setStreamError(null);
    setStreamRawError(null);
  }, []);

  const showStreamError = React.useCallback((rawError: Error | null) => {
    setStreamRawError(rawError);
    setStreamError(fallbackErrorMessageRef.current);
  }, [fallbackErrorMessageRef]);

  const internalSendingRef = React.useRef(false);
  const transportBusyRef = React.useRef(false);
  const lastSubmittedTurnRef = React.useRef<SubmittedUserTurn<TMeta> | null>(null);
  const controllerRef = React.useRef<AbortController | null>(null);
  const hasStartedAssistantRef = React.useRef(false);
  const pendingAssistantIdRef = React.useRef<string | null>(null);
  const pendingToolMessageIdsRef = React.useRef<Set<string>>(new Set());
  const toolMessageIdsByDeltaIdRef = React.useRef<Map<string, string>>(new Map());
  const activeSessionIdRef = React.useRef(0);
  const warnedMissingHandlerRef = React.useRef(false);
  const warnedTransportOnSendRef = React.useRef(false);

  const updateSessionMessages = React.useCallback((
    updater: (prev: Message<TMeta>[]) => Message<TMeta>[],
    options?: UpdateMessagesOptions,
  ) => {
    const next = updateMessages(updater, options);
    messagesRef.current = next;
    return next;
  }, [messagesRef, updateMessages]);

  const safeOnChunk = React.useCallback((chunk: string, messageId: string) => {
    try {
      onChunkRef.current?.(chunk, messageId);
    } catch (error) {
      warnObserverError('onChunk', error);
    }
  }, [onChunkRef]);

  const safeOnError = React.useCallback((error: Error) => {
    try {
      onErrorRef.current?.(error);
    } catch (callbackError) {
      warnObserverError('onError', callbackError);
    }
  }, [onErrorRef]);

  const safeOnFinish = React.useCallback((context: ChorusFinishContext<TMeta>) => {
    try {
      onFinishRef.current?.(context);
    } catch (error) {
      warnObserverError('onFinish', error);
    }
  }, [onFinishRef]);

  const safeOnStreamDone = React.useCallback((context: ChorusStreamDoneContext<TMeta>) => {
    try {
      onStreamDoneRef.current?.(context);
    } catch (error) {
      warnObserverError('onStreamDone', error);
    }
  }, [onStreamDoneRef]);

  const safeOnToolDelta = React.useCallback((context: ChorusToolDeltaContext<TMeta>) => {
    try {
      onToolDeltaRef.current?.(context);
    } catch (error) {
      warnObserverError('onToolDelta', error);
    }
  }, [onToolDeltaRef]);

  const safeNotifyToolCall = React.useCallback(async (context: ChorusToolCallContext<TMeta>) => {
    try {
      await onToolCallRef.current?.(context);
    } catch (error) {
      warnObserverError('onToolCall', error);
    }
  }, [onToolCallRef]);

  const setInternalSending = React.useCallback((next: boolean) => {
    internalSendingRef.current = next;
    setInternalSendingState(next);
  }, []);

  const setTransportBusy = React.useCallback((next: boolean) => {
    transportBusyRef.current = next;
    setTransportBusyState(next);
  }, []);

  const beginAssistantSession = React.useCallback(() => {
    activeSessionIdRef.current += 1;
    return activeSessionIdRef.current;
  }, []);

  const isAssistantSessionActive = React.useCallback((sessionId: number) => activeSessionIdRef.current === sessionId, []);

  const invalidateAssistantSession = React.useCallback((sessionId?: number) => {
    if (sessionId === undefined || activeSessionIdRef.current === sessionId) {
      activeSessionIdRef.current += 1;
    }
  }, []);

  const rememberSubmittedTurn = React.useCallback((text: string, history: Message<TMeta>[]) => {
    if (!findLastUserMessage(history)) return;
    lastSubmittedTurnRef.current = { text, history: cloneHistoryForRetry(history) };
  }, []);

  const { enqueue: enqueueTextChunk, cancelPending: cancelPendingText } = useRAFQueue((add) => {
    const id = pendingAssistantIdRef.current;
    if (!id) return;
    updateSessionMessages(prev => prev.map(m => m.id === id ? { ...m, text: m.text + add } : m), { reason: 'assistant' });
  });

  const { enqueue: enqueueReasoningChunk, cancelPending: cancelPendingReasoning } = useRAFQueue((add) => {
    const id = pendingAssistantIdRef.current;
    if (!id) return;
    updateSessionMessages(prev => prev.map(m => m.id === id ? { ...m, reasoning: `${m.reasoning ?? ''}${add}` } : m), { reason: 'assistant' });
  });

  const cancelPending = React.useCallback((flushPending: boolean) => {
    cancelPendingText(flushPending);
    cancelPendingReasoning(flushPending);
  }, [cancelPendingText, cancelPendingReasoning]);

  const resetStreamState = React.useCallback(() => {
    hasStartedAssistantRef.current = false;
    pendingAssistantIdRef.current = null;
    pendingToolMessageIdsRef.current.clear();
    toolMessageIdsByDeltaIdRef.current.clear();
    cancelPending(false);
    forceRender();
  }, [cancelPending]);

  const startAssistant = React.useCallback(({ text = '', reasoning }: { text?: string; reasoning?: string }) => {
    const id = createMessageId();
    pendingAssistantIdRef.current = id;
    hasStartedAssistantRef.current = true;
    cancelPending(false);
    updateSessionMessages(prev => prev.concat({ id, role: 'assistant', text, reasoning }), { reason: 'assistant' });
    if (text) safeOnChunk(text, id);
    forceRender();
  }, [cancelPending, safeOnChunk, updateSessionMessages]);

  const appendAssistantNow = React.useCallback((chunk: string) => {
    if (!chunk) return;
    if (!pendingAssistantIdRef.current) startAssistant({ text: chunk });
    else {
      enqueueTextChunk(chunk);
      const id = pendingAssistantIdRef.current;
      if (id) safeOnChunk(chunk, id);
    }
  }, [enqueueTextChunk, safeOnChunk, startAssistant]);

  const appendAssistantReasoningNow = React.useCallback((chunk: string) => {
    if (!chunk) return;
    if (!pendingAssistantIdRef.current) startAssistant({ reasoning: chunk });
    else enqueueReasoningChunk(chunk);
  }, [enqueueReasoningChunk, startAssistant]);

  const toolMessageIdForDelta = React.useCallback((deltaId: string) => {
    const existing = toolMessageIdsByDeltaIdRef.current.get(deltaId);
    if (existing) return existing;
    const next = createMessageId();
    toolMessageIdsByDeltaIdRef.current.set(deltaId, next);
    return next;
  }, []);

  const appendToolDeltaNow = React.useCallback((delta: ConnectorToolDelta) => {
    const messageId = toolMessageIdForDelta(delta.id);
    pendingToolMessageIdsRef.current.add(messageId);
    hasStartedAssistantRef.current = true;
    let updatedMessage: Message<TMeta> | null = null;
    const nextMessages = updateSessionMessages(prev => {
      const idx = prev.findIndex(m => m.id === messageId);
      const existing = idx >= 0 ? prev[idx] : undefined;
      const toolCall = {
        ...(existing?.toolCall ?? {}),
        id: delta.id,
        name: delta.name ?? existing?.toolCall?.name ?? delta.id,
      };
      if (Object.prototype.hasOwnProperty.call(delta, 'input')) toolCall.input = delta.input;
      if (Object.prototype.hasOwnProperty.call(delta, 'output')) toolCall.output = delta.output;

      const metadata = metadataWithToolProvider(existing?.metadata, delta);
      const nextMessage: Message<TMeta> = existing
        ? { ...existing, role: 'tool', text: existing.text ?? '', toolCall, metadata }
        : { id: messageId, role: 'tool', text: '', toolCall, metadata };
      updatedMessage = nextMessage;

      if (idx >= 0) return prev.map(m => m.id === messageId ? nextMessage : m);
      return prev.concat(nextMessage);
    }, { reason: 'assistant' });
    if (updatedMessage) safeOnToolDelta({ delta, message: updatedMessage, messages: nextMessages });
    forceRender();
  }, [safeOnToolDelta, toolMessageIdForDelta, updateSessionMessages]);

  const getToolMessagesByIds = React.useCallback((ids: Set<string>) => (
    messagesRef.current.filter(message => ids.has(message.id) && message.role === 'tool' && message.toolCall)
  ), [messagesRef]);

  const setToolOutput = React.useCallback((messageId: string, output: unknown) => {
    updateSessionMessages(prev => prev.map(message => (
      message.id === messageId && message.toolCall
        ? { ...message, toolCall: { ...message.toolCall, output } }
        : message
    )), { reason: 'assistant' });
  }, [updateSessionMessages]);

  const createToolCallContext = React.useCallback((message: Message<TMeta>, signal: AbortSignal): ChorusToolCallContext<TMeta> | null => {
    if (!message.toolCall) return null;
    const id = message.toolCall.id ?? message.id;
    const name = message.toolCall.name || id;
    const context: ChorusToolCallContext<TMeta> = {
      id,
      name,
      input: message.toolCall.input,
      message,
      messages: messagesRef.current,
      signal,
    };
    if (Object.prototype.hasOwnProperty.call(message.toolCall, 'output')) context.output = message.toolCall.output;
    return context;
  }, [messagesRef]);

  const runCompletedToolCalls = React.useCallback(async (sessionId: number, toolMessages: Message<TMeta>[], signal: AbortSignal) => {
    if (!toolMessages.length) return;

    for (const initialMessage of toolMessages) {
      if (!isAssistantSessionActive(sessionId)) return;
      if (signal.aborted) throw createAbortError();

      const currentMessage = messagesRef.current.find(message => message.id === initialMessage.id) ?? initialMessage;
      const context = createToolCallContext(currentMessage, signal);
      if (!context) continue;

      try {
        const handler = toolsRef.current?.[context.name];
        if (handler) {
          const output = await handler(context.input, context);
          if (!isAssistantSessionActive(sessionId)) return;
          if (signal.aborted) throw createAbortError();
          setToolOutput(currentMessage.id, output);
          void safeNotifyToolCall({ ...context, output, message: messagesRef.current.find(message => message.id === currentMessage.id) ?? currentMessage, messages: messagesRef.current });
          continue;
        }

        const onToolCallHandler = onToolCallRef.current;
        if (!onToolCallHandler) continue;
        const output = await onToolCallHandler(context);
        if (!isAssistantSessionActive(sessionId)) return;
        if (signal.aborted) throw createAbortError();
        if (output !== undefined) setToolOutput(currentMessage.id, output);
      } catch (error) {
        if (!signal.aborted && !isAbortError(error) && isAssistantSessionActive(sessionId)) {
          setToolOutput(currentMessage.id, { error: toError(error).message });
        }
        throw error;
      }
    }
  }, [createToolCallContext, isAssistantSessionActive, messagesRef, onToolCallRef, safeNotifyToolCall, setToolOutput, toolsRef]);

  const finalizeAssistantNow = React.useCallback(() => {
    cancelPending(true);
    flushPersistence();
    const id = pendingAssistantIdRef.current;
    const message = id ? messagesRef.current.find(m => m.id === id) ?? null : null;
    hasStartedAssistantRef.current = false;
    pendingAssistantIdRef.current = null;
    pendingToolMessageIdsRef.current.clear();
    toolMessageIdsByDeltaIdRef.current.clear();
    setInternalSending(false);
    forceRender();
    return message;
  }, [cancelPending, flushPersistence, messagesRef, setInternalSending]);

  const completeActiveSession = React.useCallback((
    sessionId: number,
    finish?: { reason: ChorusFinishContext<TMeta>['reason']; response?: Response; message?: Message<TMeta> },
  ) => {
    if (!isAssistantSessionActive(sessionId)) return null;

    const message = finish?.message ?? finalizeAssistantNow();
    if (finish?.message) {
      cancelPending(true);
      flushPersistence();
      hasStartedAssistantRef.current = false;
      pendingAssistantIdRef.current = null;
      pendingToolMessageIdsRef.current.clear();
      toolMessageIdsByDeltaIdRef.current.clear();
      setInternalSending(false);
      forceRender();
    }

    invalidateAssistantSession(sessionId);
    if (finish && message) {
      safeOnFinish({
        message,
        messages: messagesRef.current,
        reason: finish.reason,
        response: finish.response,
      });
    }
    return message;
  }, [cancelPending, finalizeAssistantNow, flushPersistence, invalidateAssistantSession, isAssistantSessionActive, messagesRef, safeOnFinish, setInternalSending]);

  const createSessionHelpers = React.useCallback((sessionId: number, signal: AbortSignal, startedAt: number) => {
    type BufferedHelperEvent =
      | { type: 'text'; chunk: string }
      | { type: 'reasoning'; chunk: string }
      | { type: 'toolDelta'; delta: ConnectorToolDelta };

    let released = minAssistantDelayMsRef.current <= 0;
    let bufferedEvents: BufferedHelperEvent[] = [];
    let finalizeRequested = false;
    let finalizeCalled = false;
    let releaseTimer: ReturnType<typeof setTimeout> | null = null;

    const clearReleaseTimer = () => {
      if (releaseTimer !== null) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
    };

    const isActive = () => isAssistantSessionActive(sessionId) && !signal.aborted;

    const deliverEvent = (event: BufferedHelperEvent) => {
      if (!isActive()) return;
      if (event.type === 'text') appendAssistantNow(event.chunk);
      else if (event.type === 'reasoning') appendAssistantReasoningNow(event.chunk);
      else appendToolDeltaNow(event.delta);
    };

    const flushBufferedEvents = () => {
      clearReleaseTimer();
      if (released) return;
      if (!isActive()) {
        bufferedEvents = [];
        finalizeRequested = false;
        return;
      }

      released = true;
      const events = bufferedEvents;
      bufferedEvents = [];
      for (const event of events) deliverEvent(event);
      if (finalizeRequested) completeActiveSession(sessionId, { reason: 'done' });
    };

    const scheduleRelease = () => {
      if (released || releaseTimer !== null) return;
      const wait = Math.max(0, minAssistantDelayMsRef.current - (Date.now() - startedAt));
      if (wait <= 0) {
        flushBufferedEvents();
        return;
      }
      releaseTimer = setTimeout(flushBufferedEvents, wait);
    };

    const appendEvent = (event: BufferedHelperEvent) => {
      if (!isActive()) return;
      if ((event.type === 'text' || event.type === 'reasoning') && !event.chunk) return;

      if (released || Date.now() - startedAt >= minAssistantDelayMsRef.current) {
        if (!released) flushBufferedEvents();
        deliverEvent(event);
        return;
      }

      bufferedEvents.push(event);
      scheduleRelease();
    };

    const appendAssistant = (chunk: string) => appendEvent({ type: 'text', chunk });
    const appendReasoning = (chunk: string) => appendEvent({ type: 'reasoning', chunk });
    const appendToolDelta = (delta: ConnectorToolDelta) => appendEvent({ type: 'toolDelta', delta });

    const requestFinalize = (forceFlush: boolean) => {
      if (!isActive()) return;

      if (!released && bufferedEvents.length > 0) {
        finalizeRequested = true;
        if (forceFlush) flushBufferedEvents();
        else scheduleRelease();
        return;
      }

      clearReleaseTimer();
      completeActiveSession(sessionId, { reason: 'done' });
    };

    const finalizeAssistant = () => {
      finalizeCalled = true;
      requestFinalize(false);
    };

    const autoFinalizeAssistant = () => requestFinalize(true);

    const streamCallbacks = (): SendCallbacks => ({
      onChunk: appendAssistant,
      onReasoning: appendReasoning,
      onToolDelta: appendToolDelta,
      onDone: finalizeAssistant,
    });

    return {
      helpers: { appendAssistant, appendReasoning, appendToolDelta, finalizeAssistant, streamCallbacks, signal, systemPrompt: systemPromptRef.current },
      hasPendingAssistant: () => bufferedEvents.length > 0 || finalizeRequested,
      hasAssistantOutput: () => hasStartedAssistantRef.current || bufferedEvents.length > 0,
      wasFinalizeRequested: () => finalizeCalled,
      autoFinalizeAssistant,
    };
  }, [appendAssistantNow, appendAssistantReasoningNow, appendToolDeltaNow, completeActiveSession, isAssistantSessionActive, minAssistantDelayMsRef, systemPromptRef]);

  const resolvedTransport = React.useMemo((): Transport<TMeta> => {
    if (typeof transport === 'string') return createFetchSSETransport<TMeta>(transport);
    if (typeof transport === 'function') return transport;
    return () => Promise.resolve(new Response(null, { status: 200 }));
  }, [transport]);

  const { send: doStream, abort: streamAbort, sending: streamSending } = useChorusStream<TMeta>(resolvedTransport, { connector });
  const streamSendingRef = useLatestRef(streamSending);
  const sending = transport ? (streamSending || transportBusy) : internalSending;

  const isBusy = React.useCallback(() => (
    transportRef.current
      ? streamSendingRef.current || transportBusyRef.current
      : internalSendingRef.current
  ), [streamSendingRef, transportRef]);

  const removePendingAssistant = React.useCallback(() => {
    const partialId = pendingAssistantIdRef.current;
    const toolMessageIds = new Set(pendingToolMessageIdsRef.current);
    resetStreamState();
    if (partialId || toolMessageIds.size > 0) {
      updateSessionMessages(prev => prev.filter(m => m.id !== partialId && !toolMessageIds.has(m.id)), { flushPersistence: true, reason: 'delete' });
    }
  }, [resetStreamState, updateSessionMessages]);

  const historyForTransport = React.useCallback((history: Message<TMeta>[]): Message<TMeta>[] => (
    systemPromptRef.current
      ? [{ id: 'chorus-system-prompt', role: 'system' as const, text: systemPromptRef.current }, ...history]
      : history
  ), [systemPromptRef]);

  type FinishTransportStream = (sessionId: number, response: Response | undefined, controller: AbortController, iteration: number) => Promise<void>;
  const finishTransportStreamRef = React.useRef<FinishTransportStream | null>(null);

  const startTransportStream = React.useCallback((
    sessionId: number,
    text: string,
    history: Message<TMeta>[],
    controller: AbortController,
    iteration: number,
  ) => {
    void doStream(text, historyForTransport(history), {
      onChunk: (chunk) => {
        if (isAssistantSessionActive(sessionId)) appendAssistantNow(chunk);
      },
      onReasoning: (chunk) => {
        if (isAssistantSessionActive(sessionId)) appendAssistantReasoningNow(chunk);
      },
      onToolDelta: (delta) => {
        if (isAssistantSessionActive(sessionId)) appendToolDeltaNow(delta);
      },
      onDone: (response) => {
        if (!isAssistantSessionActive(sessionId)) return;
        void finishTransportStreamRef.current?.(sessionId, response, controller, iteration);
      },
      onError: (err) => {
        if (!isAssistantSessionActive(sessionId)) return;
        removePendingAssistant();
        invalidateAssistantSession(sessionId);
        setTransportBusy(false);
        if (controllerRef.current === controller) controllerRef.current = null;
        safeOnError(err);
        showStreamError(err);
      },
      minDelayMs: minAssistantDelayMsRef.current,
    }, controller.signal).catch(() => {
      setTransportBusy(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    });
  }, [appendAssistantNow, appendAssistantReasoningNow, appendToolDeltaNow, doStream, historyForTransport, invalidateAssistantSession, isAssistantSessionActive, minAssistantDelayMsRef, removePendingAssistant, safeOnError, setTransportBusy, showStreamError]);

  const shouldContinueAfterTools = React.useCallback(async (
    iteration: number,
    assistantMessage: Message<TMeta> | null,
    toolMessages: Message<TMeta>[],
    response: Response | undefined,
    signal: AbortSignal,
  ) => {
    if (!autoContinueToolsRef.current || !toolMessages.length) return false;
    if (!toolMessages.every(hasToolOutput)) return false;

    const configuredMax = maxToolIterationsRef.current;
    const maxToolIterations = Number.isFinite(configuredMax)
      ? Math.max(0, Math.floor(configuredMax))
      : DEFAULT_MAX_TOOL_ITERATIONS;
    const nextIteration = iteration + 1;
    if (nextIteration > maxToolIterations) return false;
    if (signal.aborted) throw createAbortError();

    const shouldContinue = await shouldContinueToolLoopRef.current?.({
      assistantMessage,
      toolMessages,
      messages: messagesRef.current,
      response,
      iteration: nextIteration,
      maxToolIterations,
      signal,
    });
    if (signal.aborted) throw createAbortError();
    return shouldContinue ?? true;
  }, [autoContinueToolsRef, maxToolIterationsRef, messagesRef, shouldContinueToolLoopRef]);

  const finishTransportStream = React.useCallback<FinishTransportStream>(async (sessionId, response, controller, iteration) => {
    const toolMessageIds = new Set(pendingToolMessageIdsRef.current);
    let keepTransportBusy = false;

    try {
      await runCompletedToolCalls(sessionId, getToolMessagesByIds(toolMessageIds), controller.signal);
      if (!isAssistantSessionActive(sessionId)) return;

      const assistantMessage = finalizeAssistantNow();
      if (assistantMessage) {
        safeOnFinish({
          message: assistantMessage,
          messages: messagesRef.current,
          reason: 'done',
          response,
        });
      }

      const toolMessages = getToolMessagesByIds(toolMessageIds);
      safeOnStreamDone({
        assistantMessage,
        toolMessages,
        messages: messagesRef.current,
        response,
      });

      const shouldContinue = await shouldContinueAfterTools(iteration, assistantMessage, toolMessages, response, controller.signal);
      if (!isAssistantSessionActive(sessionId)) return;

      if (shouldContinue) {
        keepTransportBusy = true;
        startTransportStream(sessionId, '', messagesRef.current, controller, iteration + 1);
        return;
      }

      invalidateAssistantSession(sessionId);
    } catch (error) {
      if (!isAssistantSessionActive(sessionId)) return;
      cancelPending(true);
      flushPersistence();
      hasStartedAssistantRef.current = false;
      pendingAssistantIdRef.current = null;
      pendingToolMessageIdsRef.current.clear();
      toolMessageIdsByDeltaIdRef.current.clear();
      invalidateAssistantSession(sessionId);
      forceRender();

      if (!isAbortError(error)) {
        const normalizedError = toError(error);
        safeOnError(normalizedError);
        showStreamError(normalizedError);
      }
    } finally {
      if (!keepTransportBusy) {
        setTransportBusy(false);
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    }
  }, [cancelPending, finalizeAssistantNow, flushPersistence, getToolMessagesByIds, invalidateAssistantSession, isAssistantSessionActive, messagesRef, runCompletedToolCalls, safeOnError, safeOnFinish, safeOnStreamDone, setTransportBusy, shouldContinueAfterTools, showStreamError, startTransportStream]);

  finishTransportStreamRef.current = finishTransportStream;

  const triggerAssistant = React.useCallback((text: string, history: Message<TMeta>[] = messagesRef.current) => {
    const sessionId = beginAssistantSession();
    rememberSubmittedTurn(text, history);
    const currentTransport = transportRef.current;
    const currentOnSend = onSendRef.current;

    if (currentTransport) {
      if (isChorusDevMode() && currentOnSend && !warnedTransportOnSendRef.current) {
        warnedTransportOnSendRef.current = true;
        console.warn('[Chorus] Both `transport` and `onSend` props were provided. `transport` takes precedence and `onSend` will be ignored. Remove one of the two props to silence this warning.');
      }
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      resetStreamState();
      clearStreamError();
      setTransportBusy(true);
      startTransportStream(sessionId, text, history, controller, 0);
      return;
    }

    if (!currentOnSend) {
      invalidateAssistantSession(sessionId);
      if (isChorusDevMode() && !warnedMissingHandlerRef.current) {
        warnedMissingHandlerRef.current = true;
        console.warn('[Chorus] `send` was called but neither `transport` nor `onSend` was provided. Pass one of these props to produce an assistant response.');
      }
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setInternalSending(true);
    clearStreamError();
    resetStreamState();

    const startedAt = Date.now();
    const sessionHelpers = createSessionHelpers(sessionId, controller.signal, startedAt);

    void (async () => {
      try {
        const res = await currentOnSend(text, history, sessionHelpers.helpers);
        if (!isAssistantSessionActive(sessionId)) return;

        if (res && typeof res === 'object' && !hasStartedAssistantRef.current && !sessionHelpers.hasPendingAssistant()) {
          const wait = Math.max(0, minAssistantDelayMsRef.current - (Date.now() - startedAt));
          if (wait) await new Promise(r => setTimeout(r, wait));
          if (!isAssistantSessionActive(sessionId)) return;

          const returnedMessage = res as Partial<Message<TMeta>>;
          const normalizedMessage: Message<TMeta> = {
            ...(returnedMessage as Message<TMeta>),
            id: returnedMessage.id || createMessageId(),
            role: returnedMessage.role ?? 'assistant',
            text: returnedMessage.text ?? '',
          };
          updateSessionMessages(prev => prev.concat(normalizedMessage), { reason: 'assistant' });
          completeActiveSession(sessionId, { reason: 'returned-message', message: normalizedMessage });
        }

        if (isAssistantSessionActive(sessionId) && sessionHelpers.hasAssistantOutput() && !sessionHelpers.wasFinalizeRequested()) {
          if (isChorusDevMode()) {
            console.warn('[Chorus] `onSend` appended assistant chunks but resolved without calling `helpers.finalizeAssistant()`. Chorus finalized the assistant automatically to avoid leaving the conversation in a sending state.');
          }
          sessionHelpers.autoFinalizeAssistant();
        }
      } catch (e: unknown) {
        if (isAssistantSessionActive(sessionId)) {
          removePendingAssistant();
          invalidateAssistantSession(sessionId);
          setInternalSending(false);
          if (controllerRef.current === controller) controllerRef.current = null;

          if (!isAbortError(e)) {
            const error = e instanceof Error ? e : new Error(String(e));
            safeOnError(error);
            showStreamError(error);
          }
        }
      } finally {
        if (isAssistantSessionActive(sessionId) && !hasStartedAssistantRef.current && !sessionHelpers.hasPendingAssistant()) {
          completeActiveSession(sessionId);
        }
        if (controllerRef.current === controller && !isAssistantSessionActive(sessionId)) controllerRef.current = null;
      }
    })();
  }, [beginAssistantSession, clearStreamError, completeActiveSession, createSessionHelpers, invalidateAssistantSession, isAssistantSessionActive, messagesRef, minAssistantDelayMsRef, onSendRef, rememberSubmittedTurn, removePendingAssistant, resetStreamState, safeOnError, setInternalSending, setTransportBusy, showStreamError, startTransportStream, transportRef, updateSessionMessages]);

  const send = React.useCallback((rawText: string, attachments: Attachment[] = []) => {
    if (isBusy()) return false;
    const text = rawText.trim();
    if (!text && !attachments.length) return false;

    const next = updateSessionMessages(prev => prev.concat({
      id: createMessageId(),
      role: 'user',
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
    }), { reason: 'send' });
    triggerAssistant(text, next);
    return true;
  }, [isBusy, triggerAssistant, updateSessionMessages]);

  const retry = React.useCallback(() => {
    const submitted = lastSubmittedTurnRef.current;
    if (!submitted || isBusy()) return;
    const retryHistory = cloneHistoryForRetry(submitted.history);
    if (streamError) {
      updateSessionMessages(() => retryHistory, { flushPersistence: true, reason: 'retry' });
    }
    triggerAssistant(submitted.text, retryHistory);
  }, [isBusy, streamError, triggerAssistant, updateSessionMessages]);

  const stopActiveAssistant = React.useCallback(() => {
    invalidateAssistantSession();
    controllerRef.current?.abort();
    if (transportRef.current) {
      streamAbort();
      setTransportBusy(false);
    }
    controllerRef.current = null;
    finalizeAssistantNow();
  }, [finalizeAssistantNow, invalidateAssistantSession, setTransportBusy, streamAbort, transportRef]);

  const stop = React.useCallback(() => {
    if (!isBusy()) return;
    stopActiveAssistant();
  }, [isBusy, stopActiveAssistant]);

  const clear = React.useCallback(() => {
    if (isBusy()) stopActiveAssistant();
    clearStreamError();
    lastSubmittedTurnRef.current = null;
    const next = resetToInitialMessages ? seedMessagesRef.current : [];
    updateSessionMessages(() => next, {
      flushPersistence: true,
      removePersistenceIfEmpty: !resetToInitialMessages && seedMessagesRef.current.length === 0,
      reason: 'clear',
    });
    onClearRef.current?.(next);
  }, [clearStreamError, isBusy, onClearRef, resetToInitialMessages, seedMessagesRef, stopActiveAssistant, updateSessionMessages]);

  const handleEdit = React.useCallback((id: string, newText: string) => {
    if (isBusy()) return;
    const currentMessages = messagesRef.current;
    const idx = currentMessages.findIndex(m => m.id === id);
    if (idx === -1) return;
    const edited: Message<TMeta> = { ...currentMessages[idx], text: newText };
    const next = updateSessionMessages(prev => [...prev.slice(0, idx), edited], { flushPersistence: true, reason: 'edit' });
    triggerAssistant(newText, next);
  }, [isBusy, messagesRef, triggerAssistant, updateSessionMessages]);

  const handleRegenerate = React.useCallback((id: string) => {
    if (isBusy()) return;
    const currentMessages = messagesRef.current;
    const idx = currentMessages.findIndex(m => m.id === id);
    if (idx === -1) return;
    let userIdx = idx - 1;
    while (userIdx >= 0 && currentMessages[userIdx].role !== 'user') userIdx -= 1;
    if (userIdx < 0) return;
    const userMsg = currentMessages[userIdx];
    const next = updateSessionMessages(prev => {
      const history = streamError ? dropTrailingAssistant(prev) : prev;
      return history.slice(0, userIdx + 1);
    }, { flushPersistence: true, reason: 'regenerate' });
    triggerAssistant(userMsg.text, next);
  }, [isBusy, messagesRef, streamError, triggerAssistant, updateSessionMessages]);

  const handleDelete = React.useCallback((id: string) => {
    updateSessionMessages(prev => prev.filter(m => m.id !== id), { flushPersistence: true, reason: 'delete' });
  }, [updateSessionMessages]);

  const streamingMessageId = sending && hasStartedAssistantRef.current ? pendingAssistantIdRef.current : null;

  return {
    send,
    retry,
    stop,
    clear,
    dismissError: clearStreamError,
    handleEdit,
    handleRegenerate,
    handleDelete,
    sending,
    streamError,
    streamRawError,
    streamingMessageId,
    hasStartedAssistant: hasStartedAssistantRef.current,
  };
}
