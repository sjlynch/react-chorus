import type { Message } from '../../types';
import { useLatestRef } from '../useLatestRef';
import type { UseAssistantSessionOptions } from '../useAssistantSession';

type RefValues<TMeta> = {
  messages: Message<TMeta>[];
  transport: UseAssistantSessionOptions<TMeta>['transport'];
  onSend: UseAssistantSessionOptions<TMeta>['onSend'];
  onError: UseAssistantSessionOptions<TMeta>['onError'];
  onFinish: UseAssistantSessionOptions<TMeta>['onFinish'];
  onAbort: UseAssistantSessionOptions<TMeta>['onAbort'];
  onStreamDone: UseAssistantSessionOptions<TMeta>['onStreamDone'];
  onStreamWarning: UseAssistantSessionOptions<TMeta>['onStreamWarning'];
  onStreamMetadata: UseAssistantSessionOptions<TMeta>['onStreamMetadata'];
  onToolCall: UseAssistantSessionOptions<TMeta>['onToolCall'];
  onToolDelta: UseAssistantSessionOptions<TMeta>['onToolDelta'];
  tools: UseAssistantSessionOptions<TMeta>['tools'];
  autoContinueTools: boolean;
  maxToolIterations: number;
  continueOnToolError: boolean;
  shouldContinueToolLoop: UseAssistantSessionOptions<TMeta>['shouldContinueToolLoop'];
  confirmDeleteMessage: UseAssistantSessionOptions<TMeta>['confirmDeleteMessage'];
  confirmClearConversation: UseAssistantSessionOptions<TMeta>['confirmClearConversation'];
  persistenceKey: string | undefined;
  resetToInitialMessages: boolean;
  onClear: UseAssistantSessionOptions<TMeta>['onClear'];
  fallbackErrorMessage: string;
  systemPrompt: string | undefined;
  minAssistantDelayMs: number;
  seedMessages: Message<TMeta>[];
  transformRequest: UseAssistantSessionOptions<TMeta>['transformRequest'];
};

export function useAssistantSessionRefs<TMeta>(v: RefValues<TMeta>) {
  return {
    messages: useLatestRef(v.messages),
    transport: useLatestRef(v.transport),
    onSend: useLatestRef(v.onSend),
    onError: useLatestRef(v.onError),
    onFinish: useLatestRef(v.onFinish),
    onAbort: useLatestRef(v.onAbort),
    onStreamDone: useLatestRef(v.onStreamDone),
    onStreamWarning: useLatestRef(v.onStreamWarning),
    onStreamMetadata: useLatestRef(v.onStreamMetadata),
    onToolCall: useLatestRef(v.onToolCall),
    onToolDelta: useLatestRef(v.onToolDelta),
    tools: useLatestRef(v.tools),
    autoContinueTools: useLatestRef(v.autoContinueTools),
    maxToolIterations: useLatestRef(v.maxToolIterations),
    continueOnToolError: useLatestRef(v.continueOnToolError),
    shouldContinueToolLoop: useLatestRef(v.shouldContinueToolLoop),
    confirmDeleteMessage: useLatestRef(v.confirmDeleteMessage),
    confirmClearConversation: useLatestRef(v.confirmClearConversation),
    persistenceKey: useLatestRef(v.persistenceKey),
    resetToInitialMessages: useLatestRef(v.resetToInitialMessages),
    onClear: useLatestRef(v.onClear),
    fallbackErrorMessage: useLatestRef(v.fallbackErrorMessage),
    systemPrompt: useLatestRef(v.systemPrompt),
    minAssistantDelayMs: useLatestRef(v.minAssistantDelayMs),
    seedMessages: useLatestRef(v.seedMessages),
    transformRequest: useLatestRef(v.transformRequest),
  };
}
