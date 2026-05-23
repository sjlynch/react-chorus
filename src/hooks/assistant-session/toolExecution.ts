import React from 'react';
import type { Message, ToolMessage } from '../../types';
import type { ConnectorToolDelta } from '../../connectors/connectors';
import type { ChorusToolDefinition, ChorusToolRegistry } from '../../tools';
import type { ToolPolicyStore } from '../conversations/toolPolicyStore';
import { RESERVED_UI_TOOL_NAMES } from '../../approvals/types';
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

function lookupToolDefinitionLocal<TMeta>(
  registry: ChorusToolRegistry<TMeta> | undefined,
  name: string,
): ChorusToolDefinition<TMeta> | undefined {
  if (!registry) return undefined;
  const entry = Array.isArray(registry)
    ? registry.find((definition: ChorusToolDefinition<TMeta>) => definition.name === name)
    : registry[name];
  if (!entry || typeof entry === 'function') return undefined;
  return entry;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function buildToolMessageFromDelta<TMeta>(
  messageId: string,
  delta: ConnectorToolDelta,
  existing?: ToolMessage<TMeta>,
): ToolMessage<TMeta> {
  const toolCall: ToolMessage<TMeta>['toolCall'] = {
    ...(existing?.toolCall ?? {}),
    id: delta.id,
    // `||` (not `??`) so a connector streaming an empty-string `name` falls
    // through to the id, matching `createToolCallContextFromMessage`'s
    // `name || id`. Keeping a stored `''` name would make the persisted
    // `toolCall.name` and the execution-context name disagree.
    name: delta.name || existing?.toolCall?.name || delta.id,
  };
  if (hasOwn(delta, 'input')) toolCall.input = delta.input;
  if (hasOwn(delta, 'output')) toolCall.output = delta.output;

  return {
    id: messageId,
    role: 'tool',
    text: existing?.text ?? '',
    reasoning: existing?.reasoning,
    metadata: metadataWithToolProvider(existing?.metadata, delta),
    toolCall,
  };
}

interface ApplyToolOutputOptions {
  isError?: boolean;
}

export function applyToolOutput<TMeta>(
  message: Message<TMeta>,
  output: unknown,
  options: ApplyToolOutputOptions = {},
): Message<TMeta> {
  if (message.role !== 'tool') return message;
  const next: ToolMessage<TMeta> = {
    ...message,
    toolCall: { ...message.toolCall, output },
  };
  if (options.isError) next.metadata = metadataWithToolError(message.metadata);
  return next;
}

export function createToolCallContextFromMessage<TMeta>(
  message: Message<TMeta>,
  messages: Message<TMeta>[],
  signal: AbortSignal,
): ChorusToolCallContext<TMeta> | null {
  if (message.role !== 'tool') return null;
  const id = message.toolCall.id ?? message.id;
  const name = message.toolCall.name || id;
  const context: ChorusToolCallContext<TMeta> = {
    id,
    name,
    input: message.toolCall.input,
    message,
    messages,
    signal,
  };
  if (hasOwn(message.toolCall, 'output')) context.output = message.toolCall.output;
  return context;
}

export interface ToolExecutionDeps<TMeta> {
  updateSessionMessages: UpdateSessionMessages<TMeta>;
  messagesRef: React.MutableRefObject<Message<TMeta>[]>;
  pendingToolMessageIdsRef: React.MutableRefObject<Set<string>>;
  toolMessageIdsByDeltaIdRef: React.MutableRefObject<Map<string, string>>;
  hasStartedAssistantRef: React.MutableRefObject<boolean>;
  toolsRef: React.MutableRefObject<ChorusToolRegistry<TMeta> | undefined>;
  onToolCallRef: React.MutableRefObject<ChorusOnToolCall<TMeta> | undefined>;
  continueOnToolErrorRef: React.MutableRefObject<boolean>;
  safeOnToolDelta: ObserverCallbacks<TMeta>['safeOnToolDelta'];
  safeNotifyToolCall: ObserverCallbacks<TMeta>['safeNotifyToolCall'];
  isAssistantSessionActive: (sessionId: number) => boolean;
  forceRender: () => void;
  policyStoreRef: React.MutableRefObject<ToolPolicyStore | null>;
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
    continueOnToolErrorRef,
    safeOnToolDelta,
    safeNotifyToolCall,
    isAssistantSessionActive,
    forceRender,
    policyStoreRef,
  } = deps;

  const setToolApprovalState = React.useCallback((messageId: string, approval: 'pending' | 'allowed' | 'denied' | undefined) => {
    updateSessionMessages(prev => prev.map(message => {
      if (message.id !== messageId || message.role !== 'tool') return message;
      const nextToolCall = { ...message.toolCall };
      if (approval === undefined) delete (nextToolCall as { approval?: unknown }).approval;
      else nextToolCall.approval = approval;
      return { ...message, toolCall: nextToolCall };
    }), { reason: 'assistant' });
  }, [updateSessionMessages]);

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
      const found = idx >= 0 ? prev[idx] : undefined;
      const existing = found?.role === 'tool' ? found : undefined;
      const nextMessage = buildToolMessageFromDelta<TMeta>(messageId, delta, existing);
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
      message.id === messageId ? applyToolOutput(message, output) : message
    )), { reason: 'assistant' });
  }, [updateSessionMessages]);

  const setToolErrorOutput = React.useCallback((messageId: string, output: unknown) => {
    updateSessionMessages(prev => prev.map(message => (
      message.id === messageId ? applyToolOutput(message, output, { isError: true }) : message
    )), { reason: 'assistant' });
  }, [updateSessionMessages]);

  const createToolCallContext = React.useCallback((message: Message<TMeta>, signal: AbortSignal): ChorusToolCallContext<TMeta> | null => (
    createToolCallContextFromMessage(message, messagesRef.current, signal)
  ), [messagesRef]);

  const runCompletedToolCalls = React.useCallback(async (sessionId: number, toolMessages: ToolMessage<TMeta>[], signal: AbortSignal) => {
    if (!toolMessages.length) return;

    for (const initialMessage of toolMessages) {
      if (!isAssistantSessionActive(sessionId)) return;
      if (signal.aborted) throw createAbortError();

      const currentMessage = messagesRef.current.find(message => message.id === initialMessage.id) ?? initialMessage;
      if (currentMessage.role !== 'tool') continue;
      const context = createToolCallContext(currentMessage, signal);
      if (!context) continue;

      // Approval gate: applies only to tools whose definition marks them
      // `requiresApproval` (or MCP-defaulted), and only when the resolved
      // policy is `'ask'` or `'deny'`. Reserved UI tools are exempt — the
      // policy store hands back `'allow'` for them.
      const policyStore = policyStoreRef.current;
      const definition = lookupToolDefinitionLocal(toolsRef.current, context.name);
      const needsApproval = Boolean(definition?.requiresApproval) && !RESERVED_UI_TOOL_NAMES.has(context.name);
      if (needsApproval && policyStore) {
        const decision = policyStore.getDecision(context.name);
        if (decision === 'deny') {
          setToolApprovalState(currentMessage.id, 'denied');
          setToolErrorOutput(currentMessage.id, { error: '(denied by user)' });
          continue;
        }
        if (decision === 'ask') {
          setToolApprovalState(currentMessage.id, 'pending');
          const onAbort = () => policyStore.respondToApproval(context.id, 'denied');
          signal.addEventListener('abort', onAbort, { once: true });
          let resolved;
          try {
            resolved = await policyStore.requestApproval(context.id);
          } finally {
            signal.removeEventListener('abort', onAbort);
          }
          if (!isAssistantSessionActive(sessionId)) return;
          if (signal.aborted) throw createAbortError();
          if (resolved !== 'allowed') {
            const reason = resolved === 'timed-out' ? '(approval timed out)' : '(denied by user)';
            setToolApprovalState(currentMessage.id, 'denied');
            setToolErrorOutput(currentMessage.id, { error: reason });
            continue;
          }
          setToolApprovalState(currentMessage.id, 'allowed');
        }
      }

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
        // Abort errors (Stop pressed) and stale-session errors always end the
        // turn — never feed them back to the model.
        if (signal.aborted || isAbortError(error) || !isAssistantSessionActive(sessionId)) {
          throw error;
        }
        // Record the thrown error as the tool's output so the row stays
        // inspectable. `setToolErrorOutput` also flags `metadata.isError`,
        // which `toAnthropicMessagesBody` maps to `is_error: true`.
        setToolErrorOutput(currentMessage.id, { error: toError(error).message });
        // Without `continueOnToolError`, a thrown handler ends the whole turn
        // with the generic error banner (re-throw). With it opted in, the
        // recorded error output is treated as a normal tool result: the
        // auto-continue loop feeds it back to the model so it can self-recover,
        // and already-streamed assistant text from this iteration is kept.
        if (!continueOnToolErrorRef.current) throw error;
      }
    }
  }, [continueOnToolErrorRef, createToolCallContext, isAssistantSessionActive, messagesRef, onToolCallRef, policyStoreRef, safeNotifyToolCall, setToolApprovalState, setToolErrorOutput, setToolOutput, toolsRef]);

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
