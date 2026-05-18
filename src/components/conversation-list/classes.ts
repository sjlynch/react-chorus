export function conversationClasses(active: boolean, pinned: boolean) {
  return [
    'chorus-conversation-item',
    active ? 'chorus-conversation-item--active' : undefined,
    pinned ? 'chorus-conversation-item--pinned' : undefined,
  ].filter(Boolean).join(' ');
}
