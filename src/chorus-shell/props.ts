import type React from 'react';
import type { ChatInputHandle, ChatInputProps } from '../components/ChatInput';
import type { ChatWindowProps } from '../components/ChatWindow';
import type { ResolvedChorusLabels } from '../labels/types';
import type { Message } from '../types';
import type { ChorusProps } from '../Chorus.types';
import type { ChorusShellDerivedState } from './derivedState';
import type { ChorusComposerActions, ChorusComposerState } from './useComposerActions';

export type ChorusRootProps = React.HTMLAttributes<HTMLDivElement>;

export interface ChorusClearControl {
  visible: boolean;
  label: string;
  disabled: boolean;
  onClick: () => void;
}

export interface ChorusComposerView {
  ref: React.RefObject<ChatInputHandle | null>;
  props: ChatInputProps;
}

export interface ChorusShellViewProps<TMeta> {
  rootRef: React.RefObject<HTMLDivElement | null>;
  rootProps: ChorusRootProps;
  transcriptProps: ChatWindowProps<TMeta>;
  clearControl: ChorusClearControl;
  composer: ChorusComposerView;
}

export interface BuildRootPropsArgs extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  disabled: boolean;
  readOnly: boolean;
  alwaysShowMessageActions: boolean;
  writesDisabled: boolean;
  paletteVars: React.CSSProperties;
}

export function buildRootProps({
  className,
  disabled,
  readOnly,
  alwaysShowMessageActions,
  writesDisabled,
  paletteVars,
  style,
  ...rest
}: BuildRootPropsArgs): ChorusRootProps {
  return {
    ...rest,
    className: [
      'chorus',
      disabled && 'chorus--disabled',
      readOnly && 'chorus--readonly',
      alwaysShowMessageActions && 'chorus--always-show-actions',
      className,
    ].filter(Boolean).join(' '),
    style: { ...paletteVars, ...style },
    'aria-disabled': writesDisabled ? true : rest['aria-disabled'],
  };
}

interface BuildTranscriptPropsArgs<TMeta> {
  messages: Message<TMeta>[];
  shellState: ChorusShellDerivedState;
  session: {
    dismissError: () => void;
    handleDelete: (id: string) => void;
    handleEdit: (id: string, newText: string) => void;
    handleRegenerate: (id: string) => void;
    hasStartedAssistant: boolean;
    retry: () => void;
    streamError: string | null;
    streamRawError: Error | null;
    streamingMessageId: string | null;
  };
  composerActions: Pick<ChorusComposerActions, 'handleSuggestedPrompt'>;
  codeBlockTheme: NonNullable<ChorusProps<TMeta>['codeBlockTheme']>;
  emptyState: ChorusProps<TMeta>['emptyState'];
  getMessageFeedback: ChorusProps<TMeta>['getMessageFeedback'];
  headless: boolean;
  hiddenRoles: ChorusProps<TMeta>['hiddenRoles'];
  labels: ChorusProps<TMeta>['labels'];
  markdownProps: ChorusProps<TMeta>['markdownProps'];
  markdownSanitizer: ChorusProps<TMeta>['markdownSanitizer'];
  maxRenderedMessages: ChorusProps<TMeta>['maxRenderedMessages'];
  onCopy: ChorusProps<TMeta>['onCopy'];
  onFeedback: ChorusProps<TMeta>['onFeedback'];
  renderError: ChorusProps<TMeta>['renderError'];
  renderMessage: ChorusProps<TMeta>['renderMessage'];
  showTimestamps: boolean;
  formatTimestamp: ChorusProps<TMeta>['formatTimestamp'];
  suggestedPrompts: ChorusProps<TMeta>['suggestedPrompts'];
  defaultHiddenRoles: NonNullable<ChorusProps<TMeta>['hiddenRoles']>;
}

export function buildTranscriptProps<TMeta>({
  messages,
  shellState,
  session,
  composerActions,
  codeBlockTheme,
  emptyState,
  getMessageFeedback,
  headless,
  hiddenRoles,
  labels,
  markdownProps,
  markdownSanitizer,
  maxRenderedMessages,
  onCopy,
  onFeedback,
  renderError,
  renderMessage,
  showTimestamps,
  formatTimestamp,
  suggestedPrompts,
  defaultHiddenRoles,
}: BuildTranscriptPropsArgs<TMeta>): ChatWindowProps<TMeta> {
  return {
    messages,
    typing: shellState.canAssistantRespond && shellState.visualSending && !session.hasStartedAssistant,
    codeTheme: codeBlockTheme,
    emptyState: shellState.canRenderEmptyAffordance ? emptyState : undefined,
    error: session.streamError,
    headless,
    hiddenRoles: hiddenRoles ?? defaultHiddenRoles,
    markdownProps,
    markdownSanitizer,
    maxRenderedMessages,
    getMessageFeedback,
    onCopy,
    onDelete: shellState.canDeleteMessages ? session.handleDelete : undefined,
    onDismissError: session.dismissError,
    onEdit: shellState.canRunAssistantActions ? session.handleEdit : undefined,
    onFeedback: shellState.canSubmitFeedback ? onFeedback : undefined,
    onRegenerate: shellState.canRunAssistantActions ? session.handleRegenerate : undefined,
    onRetry: shellState.canRetry ? session.retry : undefined,
    onSuggestedPrompt: shellState.canSuggestPrompt ? composerActions.handleSuggestedPrompt : undefined,
    rawError: session.streamRawError,
    renderError,
    renderMessage,
    showJumpToBottomButton: shellState.resolvedShowJumpToBottomButton,
    showTimestamps,
    formatTimestamp,
    streamingMessageId: session.streamingMessageId,
    suggestedPrompts: shellState.canRenderEmptyAffordance ? suggestedPrompts : undefined,
    suggestedPromptsDisabled: shellState.writesDisabled,
    suggestedPromptsDisabledReason: shellState.resolvedDisabledReason,
    labels,
  };
}

interface BuildClearControlArgs {
  showClearButton: boolean;
  clearLabel: string;
  handleClear: () => void;
  writesDisabled: boolean;
  clearConfirmationPending: boolean;
  sending: boolean;
  messageCount: number;
}

export function buildClearControl({
  showClearButton,
  clearLabel,
  handleClear,
  writesDisabled,
  clearConfirmationPending,
  sending,
  messageCount,
}: BuildClearControlArgs): ChorusClearControl {
  return {
    visible: showClearButton,
    label: clearLabel,
    onClick: handleClear,
    disabled: writesDisabled || clearConfirmationPending || (!sending && messageCount === 0),
  };
}

interface BuildComposerViewArgs<TMeta> {
  composer: Pick<ChorusComposerState<TMeta>, 'inputRef' | 'draft' | 'setDraft' | 'composerResetKey'>;
  composerActions: Pick<ChorusComposerActions, 'handleInputSend' | 'handleStop'>;
  shellState: ChorusShellDerivedState;
  resolvedLabels: ResolvedChorusLabels;
  accept: ChorusProps<TMeta>['accept'];
  maxAttachmentBytes: ChorusProps<TMeta>['maxAttachmentBytes'];
  maxAttachments: ChorusProps<TMeta>['maxAttachments'];
  onAttachmentError: ChorusProps<TMeta>['onAttachmentError'];
  placeholder: ChorusProps<TMeta>['placeholder'];
  readOnly: boolean;
  renderAttachmentError: ChorusProps<TMeta>['renderAttachmentError'];
  uploadAttachment: ChorusProps<TMeta>['uploadAttachment'];
}

export function buildComposerView<TMeta>({
  composer,
  composerActions,
  shellState,
  resolvedLabels,
  accept,
  maxAttachmentBytes,
  maxAttachments,
  onAttachmentError,
  placeholder,
  readOnly,
  renderAttachmentError,
  uploadAttachment,
}: BuildComposerViewArgs<TMeta>): ChorusComposerView {
  return {
    ref: composer.inputRef,
    props: {
      value: composer.draft,
      onChange: composer.setDraft,
      onSend: composerActions.handleInputSend,
      onStop: composerActions.handleStop,
      sending: shellState.visualSending,
      disabled: shellState.composerDisabled,
      readOnly,
      disabledReason: shellState.resolvedDisabledReason,
      resetKey: composer.composerResetKey,
      placeholder,
      labels: resolvedLabels.composer,
      attachmentLabels: resolvedLabels.attachments,
      accept,
      maxAttachmentBytes,
      maxAttachments,
      onAttachmentError,
      renderAttachmentError,
      uploadAttachment,
    },
  };
}
