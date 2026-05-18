import { DEFAULT_COMPOSER_LABELS } from './composer';
import { DEFAULT_TRANSCRIPT_LABELS } from './transcript';
import { DEFAULT_MESSAGE_ACTION_LABELS } from './messageActions';
import { DEFAULT_SPEAKER_LABELS } from './speakers';
import { DEFAULT_TOOL_CALL_LABELS } from './toolCall';
import { DEFAULT_CODE_COPY_LABELS } from './codeCopy';
import { DEFAULT_CONVERSATION_LIST_LABELS } from './conversationList';
import { DEFAULT_CLEAR_CONVERSATION_LABEL, DEFAULT_REASONING_LABEL } from './reasoning';
import type { ChorusLabels, ResolvedChorusLabels } from './types';

export const DEFAULT_CHORUS_LABELS: ResolvedChorusLabels = {
  composer: DEFAULT_COMPOSER_LABELS,
  transcript: DEFAULT_TRANSCRIPT_LABELS,
  messageActions: DEFAULT_MESSAGE_ACTION_LABELS,
  speakers: DEFAULT_SPEAKER_LABELS,
  toolCall: DEFAULT_TOOL_CALL_LABELS,
  reasoning: DEFAULT_REASONING_LABEL,
  codeCopy: DEFAULT_CODE_COPY_LABELS,
  conversationList: DEFAULT_CONVERSATION_LIST_LABELS,
  clearConversation: DEFAULT_CLEAR_CONVERSATION_LABEL,
};

function mergeSection<T extends object>(defaults: T, override: Partial<T> | undefined): T {
  if (!override) return defaults;
  const out: T = { ...defaults };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const value = override[key];
    if (value !== undefined) out[key] = value as T[typeof key];
  }
  return out;
}

export function resolveChorusLabels(labels?: ChorusLabels): ResolvedChorusLabels {
  if (!labels) return DEFAULT_CHORUS_LABELS;
  return {
    composer: mergeSection(DEFAULT_COMPOSER_LABELS, labels.composer),
    transcript: mergeSection(DEFAULT_TRANSCRIPT_LABELS, labels.transcript),
    messageActions: mergeSection(DEFAULT_MESSAGE_ACTION_LABELS, labels.messageActions),
    speakers: mergeSection(DEFAULT_SPEAKER_LABELS, labels.speakers),
    toolCall: mergeSection(DEFAULT_TOOL_CALL_LABELS, labels.toolCall),
    reasoning: labels.reasoning ?? DEFAULT_REASONING_LABEL,
    codeCopy: mergeSection(DEFAULT_CODE_COPY_LABELS, labels.codeCopy),
    conversationList: mergeSection(DEFAULT_CONVERSATION_LIST_LABELS, labels.conversationList),
    clearConversation: labels.clearConversation ?? DEFAULT_CLEAR_CONVERSATION_LABEL,
  };
}
