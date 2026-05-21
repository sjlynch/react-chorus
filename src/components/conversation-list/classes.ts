import { joinClasses } from '../../utils/className';

export function conversationClasses(active: boolean, pinned: boolean) {
  return joinClasses(
    'chorus-conversation-item',
    active ? 'chorus-conversation-item--active' : undefined,
    pinned ? 'chorus-conversation-item--pinned' : undefined,
  );
}
