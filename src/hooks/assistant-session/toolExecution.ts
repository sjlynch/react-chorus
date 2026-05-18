import React from 'react';
import type { Message, ToolMessage } from '../../types';
import type { ConnectorToolDelta } from '../../connectors/connectors';
import type { ChorusToolDefinition, ChorusToolRegistry } from '../../tools';
import { createAbortError, isAbortError, toError } from '../../utils/errors';
import { createMessageId, metadataWithToolError, metadataWithToolProvider } from './messageUtils';
import type { ObserverCallbacks } from './observerCallbacks';
import type { ChorusOnToolCall, ChorusToolCallContext, ChorusToolHandler, UpdateSessionMessages } from './types';

// Inlined to avoid pulling the runtime body of `src/tools.ts` into the
// assistant-session chunk; the provider-requests subpath imports tools.ts and
// must stay independent of the session bundle. Keep this co-located with the
// tool-execution helpers so other assistant-session modules never import it.
export function resolveToolHandlerLocal<TMeta>(
  registry: ChorusToolRegistry<TMeta> | undefined,
  name: string,
): ChorusToolHandler<TMeta> | undefined {
  if (!registry) return undefined;
  const entry = Array.isArray(registry)
    ? registry.find((definition: ChorusToolDefinition<TMeta>) => definition.name === name)
    : registry[name];
  if (!entry) return undefined;
  if (typeof entry === 'function') return entry as ChorusToolHandler<TMeta>;
  return typeof entry.handler === 'function' ? (entry.handler as ChorusToolHandler<TMeta>) : undefined;
}

export interface ToolExecutionDeps<TMeta> {
  updateSessionMessages: UpdateSessionMessages<TMeta>;
  messagesRef: React.MutableRefObject<Message<TMeta>[]>;
  pendingToolMessageIdsRef: React.MutableRefObject<Set<string>>;
  toolMessageIdsByDeltaIdRef: React.MutableRefObject<Map<string, string>>;
  hasStartedAssistantRef: React.MutableRefObject<boolean>;
  toolsRef: React.MutableRefObject<ChorusToolRegistry<TMeta> | undefined>;
  onToolCallRef: React.MutableRefObject<ChorusOnToolCall<TMeta> | undefined>;
  safeOnToolDelta: ObserverCallbacks<TMeta>['safeOnToolDelta'];
  safeNotifyToolCall: ObserverCallbacks<TMeta>['safeNotifyToolCall'];
  isAssistantSessionActive: (sessionId: number) => boolean;
  forceRender: () => void;
}

export interface ToolExecution<TMeta> {
  toolMessageIdForDelta: (deltaId: string) => string;
  appendToolDeltaNow: (delta: ConnectorToolDelta) => void;
  getToolMessagesByIds: (ids: Set<string>) => ToolMessage<TMeta>[];
  setToolOutput: (messageId: string, output: unknown) => void;
  setToolErrorOutput: (messageId: string, output: unknown) => void;
  createToolCallContext: (message: Message<TMeta>, signal: AbortSignal) => ChorusToolCallContext<TMeta> | null;
  runCompletedToolCalls: (sessionId: number, toolMessages: ToolMessage<TMeta>[], signal: AbortSignal) => Promise<void>;
}

export function useToolExecution<TMeta>(deps: ToolExecutionDeps<TMeta>): ToolExecution<TMeta> {
  const {
    updateSessionMessages,
    messagesRef,
    pendingToolMessageIdsRef,
    toolMessageIdsByDeltaIdRef,
    hasStartedAssistantRef,
    toolsRef,
    onToolCallRef,
    safeOnToolDelta,
    safeNotifyToolCall,
    isAssistantSessionActive,
    forceRender,
  } = deps;

  const toolMessageIdForDelta = React.useCallback((deltaId: string) => {
    const existing = toolMessageIdsByDeltaIdRef.current.get(deltaId);
    if (existing) return existing;
    const next = createMessageId();
    toolMessageIdsByDeltaIdRef.current.set(deltaId, next);
    return next;
  }, [toolMessageIdsByDeltaIdRef]);

  const appendToolDeltaNow = React.useCallback((delta: ConnectorToolDelta) => {
    const messageId = toolMessageIdForDelta(delta.id);
    pendingToolMessageIdsRef.current.add(messageId);
    hasStartedAssistantRef.current = true;
    let updatedMessage: ToolMessage<TMeta> | null = null;
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
      const nextMessage: ToolMessage<TMeta> = {
        id: messageId,
        role: 'tool',
        text: existing?.text ?? '',
        reasoning: existing?.reasoning,
        metadata,
        toolCall,
      };
      updatedMessage = nextMessage;

      if (idx >= 0) return prev.map(m => m.id === messageId ? nextMessage : m);
      return prev.concat(nextMessage);
    }, { reason: 'assistant' });
    if (updatedMessage) safeOnToolDelta({ delta, message: updatedMessage, messages: nextMessages });
    forceRender();
  }, [forceRender, hasStartedAssistantRef, pendingToolMessageIdsRef, safeOnToolDelta, toolMessageIdForDelta, updateSessionMessages]);

  const getToolMessagesByIds = React.useCallback((ids: Set<string>) => (
    messagesRef.current.filter((message): message is ToolMessage<TMeta> => ids.has(message.id) && message.role === 'tool')
  ), [messagesRef]);

  const setToolOutput = React.useCallback((messageId: string, output: unknown) => {
    updateSessionMessages(prev => prev.map(message => (
      message.id === messageId && message.role === 'tool'
        ? { ...message, toolCall: { ...message.toolCall, output } }
        : message
    )), { reason: 'assistant' });
  }, [updateSessionMessages]);

  const setToolErrorOutput = React.useCallback((messageId: string, output: unknown) => {
    updateSessionMessages(prev => prev.map(message => (
      message.id === messageId && message.role === 'tool'
        ? { ...message, metadata: metadataWithToolError(message.metadata), toolCall: { ...message.toolCall, output } }
        : message
    )), { reason: 'assistant' });
  }, [updateSessionMessages]);

  const createToolCallContext = React.useCallback((message: Message<TMeta>, signal: AbortSignal): ChorusToolCallContext<TMeta> | null => {
    if (message.role !== 'tool') return null;
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

  const runCompletedToolCalls = React.useCallback(async (sessionId: number, toolMessages: ToolMessage<TMeta>[], signal: AbortSignal) => {
    if (!toolMessages.length) return;

    for (const initialMessage of toolMessages) {
      if (!isAssistantSessionActive(sessionId)) return;
      if (signal.aborted) throw createAbortError();

      const currentMessage = messagesRef.current.find(message => message.id === initialMessage.id) ?? initialMessage;
      if (currentMessage.role !== 'tool') continue;
      const context = createToolCallContext(currentMessage, signal);
      if (!context) continue;

      try {
        const handler = resolveToolHandlerLocal(toolsRef.current, context.name);
        if (handler) {
          const output = await handler(context.input, context);
          if (!isAssistantSessionActive(sessionId)) return;
          if (signal.aborted) throw createAbortError();
          setToolOutput(currentMessage.id, output);
          const latestMessage = messagesRef.current.find((message): message is ToolMessage<TMeta> => message.id === currentMessage.id && message.role === 'tool') ?? currentMessage;
          void safeNotifyToolCall({ ...context, output, message: latestMessage, messages: messagesRef.current });
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
          setToolErrorOutput(currentMessage.id, { error: toError(error).message });
        }
        throw error;
      }
    }
  }, [createToolCallContext, isAssistantSessionActive, messagesRef, onToolCallRef, safeNotifyToolCall, setToolErrorOutput, setToolOutput, toolsRef]);

  return {
    toolMessageIdForDelta,
    appendToolDeltaNow,
    getToolMessagesByIds,
    setToolOutput,
    setToolErrorOutput,
    createToolCallContext,
    runCompletedToolCalls,
  };
}
