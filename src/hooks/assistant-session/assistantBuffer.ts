import React from 'react';
import type { Message } from '../../types';
import { useRAFQueue } from '../useRAFQueue';
import { createMessageId } from './messageUtils';
import type { UpdateSessionMessages } from './types';

export interface AssistantBufferDeps<TMeta> {
  updateSessionMessages: UpdateSessionMessages<TMeta>;
  flushPersistence: () => void;
  messagesRef: React.MutableRefObject<Message<TMeta>[]>;
  safeOnChunk: (chunk: string, messageId: string) => void;
  setInternalSending: (value: boolean) => void;
  forceRender: () => void;
}

export interface AssistantBuffer<TMeta> {
  pendingAssistantIdRef: React.MutableRefObject<string | null>;
  pendingToolMessageIdsRef: React.MutableRefObject<Set<string>>;
  toolMessageIdsByDeltaIdRef: React.MutableRefObject<Map<string, string>>;
  hasStartedAssistantRef: React.MutableRefObject<boolean>;
  cancelPending: (flushPending: boolean) => void;
  /** Clears the in-flight assistant/tool refs and flushes persistence. Shared by `finalizeAssistantNow`, the forced-message branch of `completeActiveSession`, and the catch arm of `finishTransportStream`. */
  resetPendingAssistantState: () => void;
  resetStreamState: () => void;
  startAssistant: (opts: { text?: string; reasoning?: string }) => void;
  appendAssistantNow: (chunk: string) => void;
  appendAssistantReasoningNow: (chunk: string) => void;
  finalizeAssistantNow: () => Message<TMeta> | null;
}

export function useAssistantBuffer<TMeta>(deps: AssistantBufferDeps<TMeta>): AssistantBuffer<TMeta> {
  const { updateSessionMessages, flushPersistence, messagesRef, safeOnChunk, setInternalSending, forceRender } = deps;

  const hasStartedAssistantRef = React.useRef(false);
  const pendingAssistantIdRef = React.useRef<string | null>(null);
  const pendingToolMessageIdsRef = React.useRef<Set<string>>(new Set());
  const toolMessageIdsByDeltaIdRef = React.useRef<Map<string, string>>(new Map());

  // `isUnmountFlush` is true only for the synchronous flush `useRAFQueue` runs
  // during teardown. Routing it as `persistOnly` writes the final buffered token
  // into persistence without invoking a controlled host's `onChange` (or the
  // uncontrolled `setInternalMsgs`/`onMessagesChange`) after Chorus has unmounted.
  const { enqueue: enqueueTextChunk, cancelPending: cancelPendingText } = useRAFQueue((add, isUnmountFlush) => {
    const id = pendingAssistantIdRef.current;
    if (!id) return;
    updateSessionMessages(
      prev => prev.map(m => m.id === id && m.role === 'assistant' ? { ...m, text: m.text + add } : m),
      { reason: 'assistant', persistOnly: isUnmountFlush },
    );
  });

  const { enqueue: enqueueReasoningChunk, cancelPending: cancelPendingReasoning } = useRAFQueue((add, isUnmountFlush) => {
    const id = pendingAssistantIdRef.current;
    if (!id) return;
    updateSessionMessages(
      prev => prev.map(m => m.id === id ? { ...m, reasoning: `${m.reasoning ?? ''}${add}` } : m),
      { reason: 'assistant', persistOnly: isUnmountFlush },
    );
  });

  const cancelPending = React.useCallback((flushPending: boolean) => {
    cancelPendingText(flushPending);
    cancelPendingReasoning(flushPending);
  }, [cancelPendingText, cancelPendingReasoning]);

  const resetPendingAssistantState = React.useCallback(() => {
    cancelPending(true);
    flushPersistence();
    hasStartedAssistantRef.current = false;
    pendingAssistantIdRef.current = null;
    pendingToolMessageIdsRef.current.clear();
    toolMessageIdsByDeltaIdRef.current.clear();
  }, [cancelPending, flushPersistence]);

  const resetStreamState = React.useCallback(() => {
    hasStartedAssistantRef.current = false;
    pendingAssistantIdRef.current = null;
    pendingToolMessageIdsRef.current.clear();
    toolMessageIdsByDeltaIdRef.current.clear();
    cancelPending(false);
    forceRender();
  }, [cancelPending, forceRender]);

  const startAssistant = React.useCallback(({ text = '', reasoning }: { text?: string; reasoning?: string }) => {
    const id = createMessageId();
    pendingAssistantIdRef.current = id;
    hasStartedAssistantRef.current = true;
    cancelPending(false);
    updateSessionMessages(prev => prev.concat({ id, role: 'assistant', text, reasoning }), { reason: 'assistant' });
    if (text) safeOnChunk(text, id);
    forceRender();
  }, [cancelPending, forceRender, safeOnChunk, updateSessionMessages]);

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

  const finalizeAssistantNow = React.useCallback((): Message<TMeta> | null => {
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
  }, [cancelPending, flushPersistence, forceRender, messagesRef, setInternalSending]);

  return {
    pendingAssistantIdRef,
    pendingToolMessageIdsRef,
    toolMessageIdsByDeltaIdRef,
    hasStartedAssistantRef,
    cancelPending,
    resetPendingAssistantState,
    resetStreamState,
    startAssistant,
    appendAssistantNow,
    appendAssistantReasoningNow,
    finalizeAssistantNow,
  };
}
