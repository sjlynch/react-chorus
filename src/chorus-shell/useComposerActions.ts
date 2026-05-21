import React from 'react';
import type { ChatInputHandle } from '../components/ChatInput';
import type { Attachment, Message } from '../types';
import type { UseAssistantSessionResult } from '../hooks/useAssistantSession';
import { useLatestRef } from '../hooks/useLatestRef';

interface UseChorusComposerStateArgs<TMeta> {
  persistenceKey: string;
  onClear?: (messages: Message<TMeta>[]) => void;
}

export interface ChorusComposerState<TMeta> {
  inputRef: React.RefObject<ChatInputHandle | null>;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  composerResetKey: number;
  resetComposer: () => void;
  handleClearCommit: (next: Message<TMeta>[]) => void;
}

interface UseChorusComposerActionsArgs {
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  inputRef: React.RefObject<ChatInputHandle | null>;
  session: Pick<UseAssistantSessionResult, 'send' | 'stop' | 'clear' | 'clearConfirmationPending'>;
  writesDisabled: boolean;
}

export interface ChorusComposerActions {
  handleInputSend: (attachments?: Attachment[]) => boolean;
  handleStop: () => void;
  handleClear: () => void;
  handleSuggestedPrompt: (prompt: string) => void;
}

function focusComposerAtEnd(inputRef: React.RefObject<ChatInputHandle | null>) {
  const focusComposer = () => {
    inputRef.current?.focus({ caret: 'end' });
  };

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(focusComposer);
  } else {
    focusComposer();
  }
}

export function useChorusComposerState<TMeta = Record<string, unknown>>({
  persistenceKey,
  onClear,
}: UseChorusComposerStateArgs<TMeta>): ChorusComposerState<TMeta> {
  const inputRef = React.useRef<ChatInputHandle | null>(null);
  const [draft, setDraft] = React.useState('');
  const [composerResetKey, setComposerResetKey] = React.useState(0);
  const onClearRef = useLatestRef(onClear);

  const resetComposer = React.useCallback(() => {
    setDraft('');
    setComposerResetKey(key => key + 1);
  }, []);

  const previousPersistenceKeyRef = React.useRef(persistenceKey);
  React.useEffect(() => {
    if (previousPersistenceKeyRef.current === persistenceKey) return;
    previousPersistenceKeyRef.current = persistenceKey;
    resetComposer();
  }, [persistenceKey, resetComposer]);

  const handleClearCommit = React.useCallback((next: Message<TMeta>[]) => {
    resetComposer();
    onClearRef.current?.(next);
  }, [onClearRef, resetComposer]);

  return {
    inputRef,
    draft,
    setDraft,
    composerResetKey,
    resetComposer,
    handleClearCommit,
  };
}

export function useChorusComposerActions({
  draft,
  setDraft,
  inputRef,
  session,
  writesDisabled,
}: UseChorusComposerActionsArgs): ChorusComposerActions {
  const { send, stop, clear, clearConfirmationPending } = session;

  const handleInputSend = React.useCallback((attachments: Attachment[] = []) => {
    if (writesDisabled) return false;
    const accepted = send(draft, attachments);
    if (accepted) setDraft('');
    return accepted;
  }, [draft, send, setDraft, writesDisabled]);

  const handleStop = React.useCallback(() => {
    stop('user');
  }, [stop]);

  const handleClear = React.useCallback(() => {
    if (writesDisabled || clearConfirmationPending) return;
    clear('user');
  }, [clear, clearConfirmationPending, writesDisabled]);

  const handleSuggestedPrompt = React.useCallback((prompt: string) => {
    if (writesDisabled) return;
    setDraft(prompt);
    focusComposerAtEnd(inputRef);
  }, [inputRef, setDraft, writesDisabled]);

  return {
    handleInputSend,
    handleStop,
    handleClear,
    handleSuggestedPrompt,
  };
}
