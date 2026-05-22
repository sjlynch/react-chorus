import { DEFAULT_ATTACHMENT_LABELS } from './attachments';
import { DEFAULT_COMPOSER_LABELS } from './composer';
import { DEFAULT_TRANSCRIPT_LABELS } from './transcript';
import { DEFAULT_MESSAGE_ACTION_LABELS } from './messageActions';
import { DEFAULT_SPEAKER_LABELS } from './speakers';
import { DEFAULT_TOOL_CALL_LABELS } from './toolCall';
import { DEFAULT_SOURCE_LABELS } from './sources';
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
  sources: DEFAULT_SOURCE_LABELS,
  reasoning: DEFAULT_REASONING_LABEL,
  codeCopy: DEFAULT_CODE_COPY_LABELS,
  conversationList: DEFAULT_CONVERSATION_LIST_LABELS,
  attachments: DEFAULT_ATTACHMENT_LABELS,
  clearConversation: DEFAULT_CLEAR_CONVERSATION_LABEL,
};

// An override value contributes only when it is a meaningful replacement: null
// and undefined keep the default, and empty strings keep the default so a
// loose i18n catalog cannot erase UI text. Whitespace-only strings are allowed
// for the rare "render nothing" case.
function isUsableOverride(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value === '') return false;
  return true;
}

function mergeSection<T extends object>(defaults: T, override: Partial<T> | null | undefined): T {
  if (!override) return defaults;
  let out: T | null = null;
  for (const key of Object.keys(override) as (keyof T)[]) {
    const value = override[key];
    if (!isUsableOverride(value)) continue;
    if (!out) out = { ...defaults };
    out[key] = value as T[typeof key];
  }
  return out ?? defaults;
}

function mergeString(defaultValue: string, override: string | null | undefined): string {
  return isUsableOverride(override) ? (override as string) : defaultValue;
}

export function resolveChorusLabels(labels?: ChorusLabels): ResolvedChorusLabels {
  if (!labels) return DEFAULT_CHORUS_LABELS;
  return {
    composer: mergeSection(DEFAULT_COMPOSER_LABELS, labels.composer),
    transcript: mergeSection(DEFAULT_TRANSCRIPT_LABELS, labels.transcript),
    messageActions: mergeSection(DEFAULT_MESSAGE_ACTION_LABELS, labels.messageActions),
    speakers: mergeSection(DEFAULT_SPEAKER_LABELS, labels.speakers),
    toolCall: mergeSection(DEFAULT_TOOL_CALL_LABELS, labels.toolCall),
    sources: mergeSection(DEFAULT_SOURCE_LABELS, labels.sources),
    reasoning: mergeString(DEFAULT_REASONING_LABEL, labels.reasoning),
    codeCopy: mergeSection(DEFAULT_CODE_COPY_LABELS, labels.codeCopy),
    conversationList: mergeSection(DEFAULT_CONVERSATION_LIST_LABELS, labels.conversationList),
    attachments: mergeSection(DEFAULT_ATTACHMENT_LABELS, labels.attachments),
    clearConversation: mergeString(DEFAULT_CLEAR_CONVERSATION_LABEL, labels.clearConversation),
  };
}
