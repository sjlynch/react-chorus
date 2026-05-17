import type { Role } from '../types';
import type { ChorusSpeakerLabels } from './types';

export const DEFAULT_SPEAKER_LABELS: ChorusSpeakerLabels = {
  user: 'User message',
  assistant: 'Assistant message',
  system: 'System message',
  tool: 'Tool message',
};

export function resolveSpeakerLabel(role: Role, speakers: ChorusSpeakerLabels = DEFAULT_SPEAKER_LABELS): string {
  switch (role) {
    case 'assistant': return speakers.assistant;
    case 'system': return speakers.system;
    case 'tool': return speakers.tool;
    case 'user':
    default: return speakers.user;
  }
}
