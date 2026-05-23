import React from 'react';
import type { BlockEmit, BlockRegistry, ToolLoadingComponents } from './types';

/**
 * Runtime values threaded through the transcript so the default message
 * renderer can resolve registered blocks and per-tool loaders without
 * prop-drilling through `ChatWindow` → `MessageList` → `MessageRow` →
 * `MessageBubbleLayout`.
 *
 * The provider is mounted by the `<Chorus>` shell; standalone consumers of
 * `ChatWindow` / `MessageBubble` get an empty default (no blocks, no custom
 * loaders), so existing transcripts render unchanged.
 */
export interface BlockRuntime {
  blocks?: BlockRegistry;
  toolLoadingComponents?: ToolLoadingComponents;
  emit: BlockEmit;
  /**
   * Whether the assistant session is currently sending. Used by the per-tool
   * loader slot to keep the loader visible for a tool row whose
   * `streamingMessageId` derivation comes up empty (tool-only turn with no
   * assistant message id yet).
   */
  sending?: boolean;
}

const noopEmit: BlockEmit = () => {};

export const BlockRuntimeContext = React.createContext<BlockRuntime>({ emit: noopEmit });

export function useBlockRuntime(): BlockRuntime {
  return React.useContext(BlockRuntimeContext);
}

export interface BlockProviderProps {
  blocks?: BlockRegistry;
  toolLoadingComponents?: ToolLoadingComponents;
  emit: BlockEmit;
  sending?: boolean;
  children: React.ReactNode;
}

export function BlockProvider({ blocks, toolLoadingComponents, emit, sending, children }: BlockProviderProps) {
  const value = React.useMemo<BlockRuntime>(
    () => ({ blocks, toolLoadingComponents, emit, sending }),
    [blocks, toolLoadingComponents, emit, sending],
  );
  return <BlockRuntimeContext.Provider value={value}>{children}</BlockRuntimeContext.Provider>;
}
