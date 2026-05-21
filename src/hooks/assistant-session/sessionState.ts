import React from 'react';
import type { Message } from '../../types';
import { useMirroredState } from '../useMirroredState';
import type { SubmittedUserTurn, UpdateMessagesOptions } from './types';

export interface AssistantSessionStateDeps<TMeta> {
  messagesRef: React.MutableRefObject<Message<TMeta>[]>;
  fallbackErrorMessageRef: React.MutableRefObject<string>;
  updateMessages: (updater: (prev: Message<TMeta>[]) => Message<TMeta>[], options?: UpdateMessagesOptions) => Message<TMeta>[];
}

export interface AssistantSessionState<TMeta> {
  pendingDeleteIdsRef: React.MutableRefObject<Set<string>>;
  clearConfirmationActiveRef: React.MutableRefObject<boolean>;
  clearConfirmationPending: boolean;
  setClearConfirmationPending: React.Dispatch<React.SetStateAction<boolean>>;
  internalSending: boolean;
  setInternalSending: (next: boolean) => void;
  internalSendingRef: React.MutableRefObject<boolean>;
  transportBusy: boolean;
  setTransportBusy: (next: boolean) => void;
  transportBusyRef: React.MutableRefObject<boolean>;
  streamError: string | null;
  streamRawError: Error | null;
  clearStreamError: () => void;
  showStreamError: (rawError: Error | null) => void;
  lastSubmittedTurnRef: React.MutableRefObject<SubmittedUserTurn<TMeta> | null>;
  updateSessionMessages: (
    updater: (prev: Message<TMeta>[]) => Message<TMeta>[],
    options?: UpdateMessagesOptions,
  ) => Message<TMeta>[];
  forceRender: () => void;
}

/**
 * Owns facade-local refs/state that are shared across the assistant-session
 * sub-hooks. Keeping this setup together lets `useAssistantSession` read as a
 * top-level assembly of refs, buffer, orchestrator, tools, transport, and commands.
 */
export function useAssistantSessionState<TMeta>({
  messagesRef,
  fallbackErrorMessageRef,
  updateMessages,
}: AssistantSessionStateDeps<TMeta>): AssistantSessionState<TMeta> {
  const pendingDeleteIdsRef = React.useRef(new Set<string>());
  const clearConfirmationActiveRef = React.useRef(false);

  const [clearConfirmationPending, setClearConfirmationPending] = React.useState(false);
  const [internalSending, setInternalSending, internalSendingRef] = useMirroredState(false);
  const [transportBusy, setTransportBusy, transportBusyRef] = useMirroredState(false);
  const [streamError, setStreamError] = React.useState<string | null>(null);
  const [streamRawError, setStreamRawError] = React.useState<Error | null>(null);
  const [, forceRenderImpl] = React.useReducer((value: number) => value + 1, 0);
  const forceRender = forceRenderImpl as () => void;

  const clearStreamError = React.useCallback(() => {
    setStreamError(null);
    setStreamRawError(null);
  }, []);

  const showStreamError = React.useCallback((rawError: Error | null) => {
    setStreamRawError(rawError);
    setStreamError(fallbackErrorMessageRef.current);
  }, [fallbackErrorMessageRef]);

  const lastSubmittedTurnRef = React.useRef<SubmittedUserTurn<TMeta> | null>(null);

  const updateSessionMessages = React.useCallback((
    updater: (prev: Message<TMeta>[]) => Message<TMeta>[],
    options?: UpdateMessagesOptions,
  ) => {
    const next = updateMessages(updater, options);
    messagesRef.current = next;
    return next;
  }, [messagesRef, updateMessages]);

  return {
    pendingDeleteIdsRef,
    clearConfirmationActiveRef,
    clearConfirmationPending,
    setClearConfirmationPending,
    internalSending,
    setInternalSending,
    internalSendingRef,
    transportBusy,
    setTransportBusy,
    transportBusyRef,
    streamError,
    streamRawError,
    clearStreamError,
    showStreamError,
    lastSubmittedTurnRef,
    updateSessionMessages,
    forceRender,
  };
}
