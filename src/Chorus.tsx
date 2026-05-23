import React from 'react';
import './Chorus.css';
import { ChorusShellChrome } from './chorus-shell/ChorusShellChrome';
import { useChorusShellRuntime } from './chorus-shell/useChorusShellRuntime';
import type { ChorusProps, ChorusRef } from './Chorus.types';

export type { Transport, FetchTransportInit, Connector, ChorusConnectorOptions, RenderAttachmentErrorContext, ChorusAbortContext, ChorusAbortReason, ChorusAbortSource, ChorusClearConversationContext, ChorusConfirmClearConversation, ChorusConfirmDeleteMessage, ChorusDeleteMessageContext, ChorusFinishContext, ChorusMessagesChangeContext, ChorusMessagesChangeReason, ChorusMessagesChangeSource, ChorusOnAbort, ChorusOnFinish, ChorusOnSend, ChorusOnStreamDone, ChorusOnToolCall, ChorusOnToolDelta, ChorusProps, ChorusRef, ChorusSendHelpers, ChorusSendPath, ChorusShouldContinueToolLoop, ChorusStreamDoneContext, ChorusStreamDoneReason, ChorusToolCallContext, ChorusToolDeltaContext, ChorusToolHandler, ChorusToolLoopContext, ChorusToolRegistry, McpServerConfig } from './Chorus.types';

function ChorusInner<TMeta = Record<string, unknown>>(
  props: ChorusProps<TMeta>,
  ref: React.ForwardedRef<ChorusRef<TMeta>>,
) {
  const shell = useChorusShellRuntime<TMeta>(props, ref);
  return <ChorusShellChrome<TMeta> {...shell} />;
}

export const Chorus = React.forwardRef(ChorusInner) as <TMeta = Record<string, unknown>>(
  props: ChorusProps<TMeta> & React.RefAttributes<ChorusRef<TMeta>>,
) => React.ReactElement | null;

(Chorus as React.NamedExoticComponent).displayName = 'Chorus';

export default Chorus;
