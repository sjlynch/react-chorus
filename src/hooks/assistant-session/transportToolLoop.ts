import type { Message, ToolMessage } from '../../types';
import { createAbortError } from '../../utils/errors';
import { hasToolOutput } from './messageUtils';
import { normalizeMaxToolIterations } from './toolLoop';
import type { ChorusShouldContinueToolLoop, ChorusStreamDoneReason } from './types';

export interface ToolLoopDecision {
  reason: ChorusStreamDoneReason;
  iteration: number;
  maxToolIterations: number;
  willContinue: boolean;
}

export interface DecideTransportToolLoopContinuationArgs<TMeta> {
  iteration: number;
  assistantMessage: Message<TMeta> | null;
  toolMessages: ToolMessage<TMeta>[];
  response: Response | undefined;
  signal: AbortSignal;
  messages: Message<TMeta>[];
  autoContinueTools: boolean;
  maxToolIterations: number;
  shouldContinueToolLoop?: ChorusShouldContinueToolLoop<TMeta>;
}

export async function decideTransportToolLoopContinuation<TMeta>({
  iteration,
  assistantMessage,
  toolMessages,
  response,
  signal,
  messages,
  autoContinueTools,
  maxToolIterations: rawMaxToolIterations,
  shouldContinueToolLoop,
}: DecideTransportToolLoopContinuationArgs<TMeta>): Promise<ToolLoopDecision> {
  const maxToolIterations = normalizeMaxToolIterations(rawMaxToolIterations);
  const completedIteration = iteration + 1;

  if (!autoContinueTools || !toolMessages.length || !toolMessages.every(hasToolOutput)) {
    return { reason: 'completed', iteration: completedIteration, maxToolIterations, willContinue: false };
  }

  if (completedIteration > maxToolIterations) {
    return { reason: 'max-tool-iterations', iteration: completedIteration, maxToolIterations, willContinue: false };
  }

  if (signal.aborted) throw createAbortError();

  const userDecision = await shouldContinueToolLoop?.({
    assistantMessage,
    toolMessages,
    messages,
    response,
    iteration: completedIteration,
    maxToolIterations,
    signal,
  });
  if (signal.aborted) throw createAbortError();

  const willContinue = userDecision ?? true;
  return {
    reason: willContinue ? 'tool-loop-continue' : 'tool-loop-veto',
    iteration: completedIteration,
    maxToolIterations,
    willContinue,
  };
}
