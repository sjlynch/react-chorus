import type { Role } from '../../types';
import { DEFAULT_SPEAKER_LABELS, resolveSpeakerLabel } from '../../labels/speakers';
import type { ChorusSpeakerLabels } from '../../labels/types';

export function getMessageSpeakerLabel(role: Role, speakers: ChorusSpeakerLabels = DEFAULT_SPEAKER_LABELS) {
  return resolveSpeakerLabel(role, speakers);
}

export function MessageSpeakerLabel({ role, speakers }: { role: Role; speakers?: ChorusSpeakerLabels }) {
  return <span className="chorus-sr-only">{getMessageSpeakerLabel(role, speakers)}</span>;
}
