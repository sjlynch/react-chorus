// Public-facing label barrel. The actual default constants live in per-section
// modules under `src/labels/` so the bundler can keep standalone Markdown,
// ConversationList, and ChatInput consumer bundles narrow. Internal modules
// should import the per-section files directly; this barrel exists to give
// consumers a single import path for the full API.

export type {
  ChorusAttachmentFailureContext,
  ChorusAttachmentLabels,
  ChorusAttachmentTooLargeContext,
  ChorusAttachmentTooManyContext,
  ChorusAttachmentUnsupportedTypeContext,
  ChorusCodeCopyLabels,
  ChorusComposerLabels,
  ChorusConversationListLabels,
  ChorusLabels,
  ChorusMessageActionLabels,
  ChorusSourceLabels,
  ChorusSpeakerLabels,
  ChorusToolCallLabels,
  ChorusTranscriptLabels,
  ResolvedChorusLabels,
} from './labels/types';

export { DEFAULT_ATTACHMENT_LABELS } from './labels/attachments';
export { DEFAULT_COMPOSER_LABELS } from './labels/composer';
export { DEFAULT_TRANSCRIPT_LABELS } from './labels/transcript';
export { DEFAULT_MESSAGE_ACTION_LABELS } from './labels/messageActions';
export { DEFAULT_SPEAKER_LABELS, resolveSpeakerLabel } from './labels/speakers';
export { DEFAULT_TOOL_CALL_LABELS } from './labels/toolCall';
export { DEFAULT_SOURCE_LABELS } from './labels/sources';
export { DEFAULT_CODE_COPY_LABELS } from './labels/codeCopy';
export { DEFAULT_CONVERSATION_LIST_LABELS } from './labels/conversationList';
export { DEFAULT_CLEAR_CONVERSATION_LABEL, DEFAULT_REASONING_LABEL } from './labels/reasoning';
export { DEFAULT_CHORUS_LABELS, resolveChorusLabels } from './labels/resolve';
