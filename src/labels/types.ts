// Pure type module. Importing types from here is a zero-runtime/zero-side-effect
// edge in the dependency graph, so component bundles can reference the label
// contracts without pulling sibling default constants.

export interface ChorusComposerLabels {
  placeholder: string;
  ariaLabel: string;
  attachFile: string;
  send: string;
  stop: string;
  disabledReason: string;
  readOnlyReason: string;
}

export interface ChorusTranscriptLabels {
  ariaLabel: string;
  typing: string;
  retry: string;
  jumpToLatest: string;
  suggestedPromptsAriaLabel: string;
  emptyStateTitle: string;
}

export interface ChorusMessageActionLabels {
  edit: string;
  regenerate: string;
  copy: string;
  copyFailed: string;
  thumbsUp: string;
  thumbsDown: string;
  delete: string;
  save: string;
  cancel: string;
  editTextareaAriaLabel: string;
}

export interface ChorusSpeakerLabels {
  user: string;
  assistant: string;
  system: string;
  tool: string;
}

export interface ChorusToolCallLabels {
  input: string;
  output: string;
}

export interface ChorusCodeCopyLabels {
  copy: string;
  copied: string;
  failed: string;
  ariaLabel: string;
}

export interface ChorusConversationListLabels {
  newConversation: string;
  empty: string;
  pin: string;
  unpin: string;
  rename: string;
  delete: string;
  save: string;
  cancel: string;
  navAriaLabel: string;
  renameAriaLabel: (title: string) => string;
  pinAriaLabel: (title: string, pinned: boolean) => string;
  deleteAriaLabel: (title: string) => string;
}

export interface ResolvedChorusLabels {
  composer: ChorusComposerLabels;
  transcript: ChorusTranscriptLabels;
  messageActions: ChorusMessageActionLabels;
  speakers: ChorusSpeakerLabels;
  toolCall: ChorusToolCallLabels;
  reasoning: string;
  codeCopy: ChorusCodeCopyLabels;
  conversationList: ChorusConversationListLabels;
  clearConversation: string;
}

export type ChorusLabels = {
  composer?: Partial<ChorusComposerLabels>;
  transcript?: Partial<ChorusTranscriptLabels>;
  messageActions?: Partial<ChorusMessageActionLabels>;
  speakers?: Partial<ChorusSpeakerLabels>;
  toolCall?: Partial<ChorusToolCallLabels>;
  reasoning?: string;
  codeCopy?: Partial<ChorusCodeCopyLabels>;
  conversationList?: Partial<ChorusConversationListLabels>;
  clearConversation?: string;
};
