import type { Role } from '../../types';

export function getMessageSpeakerLabel(role: Role) {
  switch (role) {
    case 'assistant':
      return 'Assistant message';
    case 'system':
      return 'System message';
    case 'tool':
      return 'Tool message';
    case 'user':
    default:
      return 'User message';
  }
}

export function MessageSpeakerLabel({ role }: { role: Role }) {
  return <span className="chorus-sr-only">{getMessageSpeakerLabel(role)}</span>;
}
