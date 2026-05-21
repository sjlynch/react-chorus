import { isTransportPresent } from './transportResolver';
import type { ChorusOnSend, ChorusSendPath } from './types';

export type AssistantSendPathSelection<TMeta> =
  | { path: 'transport'; onSend?: ChorusOnSend<TMeta> }
  | { path: 'onSend'; onSend: ChorusOnSend<TMeta> }
  | { path: 'missing' };

export function selectAssistantSendPath<TMeta>(
  transport: unknown,
  onSend: ChorusOnSend<TMeta> | undefined,
): AssistantSendPathSelection<TMeta> {
  if (isTransportPresent(transport)) return { path: 'transport', onSend };
  if (onSend) return { path: 'onSend', onSend };
  return { path: 'missing' };
}

export function resolveAbortSendPath(activePath: ChorusSendPath | null, transport: unknown): ChorusSendPath {
  return activePath ?? (isTransportPresent(transport) ? 'transport' : 'onSend');
}
