import type { ChorusConversationListLabels } from './types';

export const DEFAULT_CONVERSATION_LIST_LABELS: ChorusConversationListLabels = {
  newConversation: 'New conversation',
  empty: 'No conversations yet',
  pin: 'Pin',
  unpin: 'Unpin',
  rename: 'Rename',
  delete: 'Delete',
  save: 'Save',
  cancel: 'Cancel',
  navAriaLabel: 'Conversations',
  renameAriaLabel: (title: string) => `Rename ${title}`,
  pinAriaLabel: (title: string, pinned: boolean) => `${pinned ? 'Unpin' : 'Pin'} ${title}`,
  deleteAriaLabel: (title: string) => `Delete ${title}`,
  renameEmptyError: 'Enter a name for this conversation.',
  renameTooLongError: (maxLength: number) => `Use ${maxLength} characters or fewer.`,
  deletedAnnouncement: (title: string) => `Deleted conversation "${title}".`,
};
