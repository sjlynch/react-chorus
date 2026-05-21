import type { Message, ToolMessage } from '../../types';
import type { ChorusStreamDoneContext, ChorusStreamDoneReason } from './types';
import type { ToolLoopDecision } from './transportToolLoop';

export interface StreamDoneContextArgs<TMeta> {
  assistantMessage: Message<TMeta> | null;
  toolMessages: ToolMessage<TMeta>[];
  messages: Message<TMeta>[];
  response: Response | undefined;
  decision: ToolLoopDecision;
}

export function createStreamDoneContext<TMeta>({
  assistantMessage,
  toolMessages,
  messages,
  response,
  decision,
}: StreamDoneContextArgs<TMeta>): ChorusStreamDoneContext<TMeta> {
  return {
    assistantMessage,
    toolMessages,
    messages,
    response,
    reason: decision.reason,
    willContinue: decision.willContinue,
    iteration: decision.iteration,
    maxToolIterations: decision.maxToolIterations,
  };
}

export function createTerminalStreamDoneContext<TMeta>(
  args: Omit<StreamDoneContextArgs<TMeta>, 'decision'> & {
    reason: ChorusStreamDoneReason;
    iteration: number;
    maxToolIterations: number;
  },
): ChorusStreamDoneContext<TMeta> {
  const { reason, iteration, maxToolIterations, ...context } = args;
  return createStreamDoneContext({
    ...context,
    decision: { reason, iteration, maxToolIterations, willContinue: false },
  });
}
