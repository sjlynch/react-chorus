import React from 'react';
import type { Message, StorageAdapter } from '../../types';
import { isPromiseLike } from '../../utils/async';
import { getTimestamp, normalizeTitle, titleFromFirstMessage, type ConversationsState, type PendingConversationCreate } from './indexCodec';
import type { IndexPersistMode } from './indexWriteQueue';
import type { ConversationStorageOperation, ConversationSummary, RenameFromFirstMessageOptions } from './types';

type ReportConversationStorageError = (
  rawError: unknown,
  operation: ConversationStorageOperation,
  key: string,
  conversationId?: string,
) => void;

type CommitConversationIndex = (
  conversations: ConversationSummary[],
  activeId: string | null,
  persistMode?: IndexPersistMode,
) => void;

interface UseConversationActionsOptions {
  stateRef: React.RefObject<ConversationsState>;
  storageRef: React.RefObject<StorageAdapter | null>;
  indexKeyRef: React.RefObject<string>;
  messageKeyPrefixRef: React.RefObject<string>;
  defaultTitleRef: React.RefObject<string>;
  createIdRef: React.RefObject<() => string>;
  nowRef: React.RefObject<() => Date | string | number>;
  pendingCreatesRef: React.RefObject<PendingConversationCreate[]>;
  commit: CommitConversationIndex;
  reportError: ReportConversationStorageError;
}

export interface ConversationActions {
  touchConversation: (id: string) => void;
  createConversation: (title?: string) => string;
  selectConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  renameFromFirstMessage: (id: string, messages: Pick<Message, 'role' | 'text'>[], options?: RenameFromFirstMessageOptions) => void;
  deleteConversation: (id: string) => void;
  pinConversation: (id: string, pinned?: boolean) => void;
}

export function useConversationActions({
  stateRef,
  storageRef,
  indexKeyRef,
  messageKeyPrefixRef,
  defaultTitleRef,
  createIdRef,
  nowRef,
  pendingCreatesRef,
  commit,
  reportError,
}: UseConversationActionsOptions): ConversationActions {
  const touchConversation = React.useCallback((id: string) => {
    const current = stateRef.current;
    if (!current.loaded || !current.conversations.some(conversation => conversation.id === id)) return;

    const timestamp = getTimestamp(nowRef.current);
    const conversations = current.conversations.map(conversation => (
      conversation.id === id ? { ...conversation, updatedAt: timestamp } : conversation
    ));
    commit(conversations, current.activeId, 'debounced');
  }, [commit, nowRef, stateRef]);

  const removeConversationMessages = React.useCallback((id: string) => {
    const targetStorage = storageRef.current;
    if (!targetStorage) return;

    const messageKey = `${messageKeyPrefixRef.current}${id}`;
    try {
      const result = targetStorage.removeItem
        ? targetStorage.removeItem(messageKey)
        : targetStorage.setItem(messageKey, '[]');
      if (isPromiseLike<void>(result)) Promise.resolve(result).catch(deleteError => reportError(deleteError, 'delete', messageKey, id));
    } catch (deleteError) {
      reportError(deleteError, 'delete', messageKey, id);
    }
  }, [messageKeyPrefixRef, reportError, storageRef]);

  const createConversation = React.useCallback((title?: string) => {
    const id = createIdRef.current();
    const timestamp = getTimestamp(nowRef.current);
    const normalizedTitle = normalizeTitle(title, defaultTitleRef.current);
    const conversation: ConversationSummary = {
      id,
      title: normalizedTitle,
      createdAt: timestamp,
      updatedAt: timestamp,
      pristine: normalizedTitle.trim() === defaultTitleRef.current.trim(),
    };

    const current = stateRef.current;
    const targetStorage = storageRef.current;
    if (!current.loaded && targetStorage) {
      pendingCreatesRef.current = pendingCreatesRef.current
        .filter(pendingCreate => !(pendingCreate.storage === targetStorage && pendingCreate.indexKey === indexKeyRef.current && pendingCreate.conversation.id === id))
        .concat({ storage: targetStorage, indexKey: indexKeyRef.current, conversation });
      return id;
    }

    const conversations = [
      conversation,
      ...current.conversations.filter(existing => existing.id !== id),
    ];
    commit(conversations, id);
    return id;
  }, [commit, createIdRef, defaultTitleRef, indexKeyRef, nowRef, pendingCreatesRef, stateRef, storageRef]);

  const selectConversation = React.useCallback((id: string) => {
    const current = stateRef.current;
    if (!current.loaded || !current.conversations.some(conversation => conversation.id === id)) return;

    const timestamp = getTimestamp(nowRef.current);
    const conversations = current.conversations.map(conversation => (
      conversation.id === id ? { ...conversation, updatedAt: timestamp } : conversation
    ));
    commit(conversations, id);
  }, [commit, nowRef, stateRef]);

  const renameConversation = React.useCallback((id: string, title: string) => {
    const current = stateRef.current;
    const trimmed = title.trim();
    if (!current.loaded || !trimmed || !current.conversations.some(conversation => conversation.id === id)) return;

    const timestamp = getTimestamp(nowRef.current);
    const conversations = current.conversations.map(conversation => (
      conversation.id === id ? { ...conversation, title: trimmed, updatedAt: timestamp, pristine: false } : conversation
    ));
    commit(conversations, current.activeId);
  }, [commit, nowRef, stateRef]);

  const renameFromFirstMessage = React.useCallback((id: string, messages: Pick<Message, 'role' | 'text'>[], renameOptions: RenameFromFirstMessageOptions = {}) => {
    const current = stateRef.current;
    if (!current.loaded) return;
    const conversation = current.conversations.find(existing => existing.id === id);
    if (!conversation) return;
    if (!renameOptions.overwrite && conversation.pristine === false) return;

    const generatedTitle = titleFromFirstMessage(messages, renameOptions);
    if (!generatedTitle || generatedTitle === conversation.title) return;

    const timestamp = getTimestamp(nowRef.current);
    const conversations = current.conversations.map(existing => (
      existing.id === id ? { ...existing, title: generatedTitle, updatedAt: timestamp, pristine: false } : existing
    ));
    commit(conversations, current.activeId);
  }, [commit, nowRef, stateRef]);

  const deleteConversation = React.useCallback((id: string) => {
    const current = stateRef.current;
    if (!current.loaded || !current.conversations.some(conversation => conversation.id === id)) return;

    removeConversationMessages(id);
    const conversations = current.conversations.filter(conversation => conversation.id !== id);
    const activeId = current.activeId === id ? conversations[0]?.id ?? null : current.activeId;
    commit(conversations, activeId);
  }, [commit, removeConversationMessages, stateRef]);

  const pinConversation = React.useCallback((id: string, pinned = true) => {
    const current = stateRef.current;
    if (!current.loaded || !current.conversations.some(conversation => conversation.id === id)) return;

    const conversations = current.conversations.map(conversation => (
      conversation.id === id ? { ...conversation, pinned } : conversation
    ));
    commit(conversations, current.activeId);
  }, [commit, stateRef]);

  return {
    touchConversation,
    createConversation,
    selectConversation,
    renameConversation,
    renameFromFirstMessage,
    deleteConversation,
    pinConversation,
  };
}
