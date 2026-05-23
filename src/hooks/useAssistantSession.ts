import type React from 'react';
import type { Attachment, Message } from '../types';
import type { Connector, ConnectorWarning } from '../connectors/connectors';
import type { OpenAIConnectorOptions } from '../connectors/openai';
import type { ConnectorName } from '../types';
import type { Transport } from './useChorusStream';
import { useAssistantSessionRefs } from './assistant-session/useAssistantSessionRefs';
import { useAssistantSessionAssembly } from './assistant-session/assemble';
import type { FetchTransportInit } from './assistant-session/transport';
import { DEFAULT_MAX_TOOL_ITERATIONS } from './assistant-session/toolLoop';
import type { ChorusToolRegistry } from '../tools';
import type { ToolPolicyStore } from './conversations/toolPolicyStore';
import type {
  ChorusAbortSource,
  ChorusConfirmClearConversation,
  ChorusConfirmDeleteMessage,
  ChorusOnAbort,
  ChorusOnFinish,
  ChorusOnSend,
  ChorusOnStreamDone,
  ChorusOnToolCall,
  ChorusOnToolDelta,
  ChorusShouldContinueToolLoop,
  UpdateMessagesOptions,
} from './assistant-session/types';

export type {
  ChorusAbortContext,
  ChorusAbortReason,
  ChorusAbortSource,
  ChorusClearConversationContext,
  ChorusConfirmClearConversation,
  ChorusConfirmDeleteMessage,
  ChorusDeleteMessageContext,
  ChorusFinishContext,
  ChorusOnAbort,
  ChorusOnFinish,
  ChorusOnSend,
  ChorusOnStreamDone,
  ChorusOnToolCall,
  ChorusOnToolDelta,
  ChorusSendHelpers,
  ChorusSendPath,
  ChorusShouldContinueToolLoop,
  ChorusStreamDoneContext,
  ChorusStreamDoneReason,
  ChorusToolCallContext,
  ChorusToolDeltaContext,
  ChorusToolHandler,
  ChorusToolLoopContext,
} from './assistant-session/types';
export type { ChorusToolRegistry };

export interface UseAssistantSessionOptions<TMeta = Record<string, unknown>> {
  messages: Message<TMeta>[];
  updateMessages: (updater: (prev: Message<TMeta>[]) => Message<TMeta>[], options?: UpdateMessagesOptions) => Message<TMeta>[];
  seedMessages: Message<TMeta>[];
  transport?: string | FetchTransportInit<TMeta> | Transport<TMeta>;
  systemPrompt?: string;
  connector?: Connector | ConnectorName;
  connectorOptions?: OpenAIConnectorOptions;
  onSend?: ChorusOnSend<TMeta>;
  minAssistantDelayMs: number;
  fallbackErrorMessage: string;
  onError?: (error: Error) => void;
  onChunkRef: React.MutableRefObject<((chunk: string, messageId: string) => void) | undefined>;
  onFinish?: ChorusOnFinish<TMeta>;
  onAbort?: ChorusOnAbort<TMeta>;
  onStreamDone?: ChorusOnStreamDone<TMeta>;
  onStreamWarning?: (warning: ConnectorWarning) => void;
  onStreamMetadata?: (metadata: Record<string, unknown>) => void;
  onToolCall?: ChorusOnToolCall<TMeta>;
  onToolDelta?: ChorusOnToolDelta<TMeta>;
  tools?: ChorusToolRegistry<TMeta>;
  autoContinueTools?: boolean;
  maxToolIterations?: number;
  continueOnToolError?: boolean;
  shouldContinueToolLoop?: ChorusShouldContinueToolLoop<TMeta>;
  confirmDeleteMessage?: ChorusConfirmDeleteMessage<TMeta>;
  confirmClearConversation?: ChorusConfirmClearConversation<TMeta>;
  persistenceKey?: string;
  flushPersistence: () => void;
  resetToInitialMessages?: boolean;
  onClear?: (messages: Message<TMeta>[]) => void;
  /**
   * Ref to the per-tool approval policy store. The session reads this during
   * tool execution to decide whether to gate a `requiresApproval` tool call
   * via the approval card flow. May be a ref pointing at `null` when no
   * policy is configured.
   */
  policyStoreRef: React.MutableRefObject<ToolPolicyStore | null>;
}

export interface UseAssistantSessionResult {
  send: (text: string, attachments?: Attachment[]) => boolean;
  retry: () => void;
  stop: (source?: ChorusAbortSource) => void;
  clear: (source?: ChorusAbortSource) => void;
  dismissError: () => void;
  handleEdit: (id: string, newText: string) => void;
  handleRegenerate: (id: string) => void;
  handleDelete: (id: string) => void;
  sending: boolean;
  streamError: string | null;
  streamRawError: Error | null;
  streamingMessageId: string | null;
  hasStartedAssistant: boolean;
  clearConfirmationPending: boolean;
}

export function useAssistantSession<TMeta = Record<string, unknown>>(
  options: UseAssistantSessionOptions<TMeta>,
): UseAssistantSessionResult {
  const {
    messages,
    transport,
    onSend,
    onError,
    onFinish,
    onAbort,
    onStreamDone,
    onStreamWarning,
    onStreamMetadata,
    onToolCall,
    onToolDelta,
    tools,
    autoContinueTools = false,
    maxToolIterations = DEFAULT_MAX_TOOL_ITERATIONS,
    continueOnToolError = false,
    shouldContinueToolLoop,
    confirmDeleteMessage,
    confirmClearConversation,
    persistenceKey,
    resetToInitialMessages = false,
    onClear,
    fallbackErrorMessage,
    systemPrompt,
    minAssistantDelayMs,
    seedMessages,
  } = options;

  const refs = useAssistantSessionRefs<TMeta>({
    messages,
    transport,
    onSend,
    onError,
    onFinish,
    onAbort,
    onStreamDone,
    onStreamWarning,
    onStreamMetadata,
    onToolCall,
    onToolDelta,
    tools,
    autoContinueTools,
    maxToolIterations,
    continueOnToolError,
    shouldContinueToolLoop,
    confirmDeleteMessage,
    confirmClearConversation,
    persistenceKey,
    resetToInitialMessages,
    onClear,
    fallbackErrorMessage,
    systemPrompt,
    minAssistantDelayMs,
    seedMessages,
  });

  return useAssistantSessionAssembly<TMeta>({
    options: {
      ...options,
      autoContinueTools,
      maxToolIterations,
      continueOnToolError,
      resetToInitialMessages,
    },
    refs,
  });
}
