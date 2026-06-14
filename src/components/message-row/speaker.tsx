import type { Message, MessageSpeaker, Role } from '../../types';
import { DEFAULT_SPEAKER_LABELS, resolveSpeakerLabel } from '../../labels/speakers';
import type { ChorusSpeakerLabels } from '../../labels/types';

/**
 * Role-only label resolver. Kept for backward compatibility with existing
 * consumers that wire speaker labels without a message reference; new call sites
 * should prefer `resolveMessageSpeakerLabel` so a host-supplied
 * `message.speaker.name` wins over the role default.
 */
export function getMessageSpeakerLabel(role: Role, speakers: ChorusSpeakerLabels = DEFAULT_SPEAKER_LABELS): string {
  return resolveSpeakerLabel(role, speakers);
}

/**
 * Returns the visible speaker label for a message: the trimmed
 * `message.speaker.name` when present, otherwise the role label from
 * `ChorusSpeakerLabels`. Used by `MessageSpeakerLabel` and the default
 * transcript copy/export helpers so a roleplay/multi-agent transcript reads
 * "Captain Hook said …" instead of "Assistant said …" when a speaker is set.
 */
export function resolveMessageSpeakerLabel<TMeta>(
  message: Pick<Message<TMeta>, 'role' | 'speaker'>,
  speakers: ChorusSpeakerLabels = DEFAULT_SPEAKER_LABELS,
): string {
  const named = message.speaker?.name?.trim();
  if (named) return named;
  return resolveSpeakerLabel(message.role, speakers);
}

export interface MessageSpeakerLabelProps {
  role: Role;
  speakers?: ChorusSpeakerLabels;
  /** Optional speaker; when present, `speaker.name` takes precedence over the role label. */
  speaker?: MessageSpeaker;
}

export function MessageSpeakerLabel({ role, speakers, speaker }: MessageSpeakerLabelProps) {
  const named = speaker?.name?.trim();
  const label = named || resolveSpeakerLabel(role, speakers);
  return <span className="chorus-sr-only">{label}</span>;
}

/**
 * Visible speaker badge rendered above the bubble when a message has a
 * `speaker`. Renders the speaker name and — when `showAvatar` is true and
 * `speaker.avatarUrl` is set — a small circular avatar. Wired by
 * `<Chorus showSpeakerAvatars>` / `<ChatWindow showSpeakerAvatars>` so apps can
 * ship multi-character transcripts (roleplay, multi-agent shells) without a
 * custom `renderMessage`. The container is `aria-hidden` because the SR-only
 * `MessageSpeakerLabel` already announces the speaker — keeping both visible
 * would duplicate the name in screen readers.
 */
export interface MessageSpeakerBadgeProps {
  speaker: MessageSpeaker;
  showAvatar?: boolean;
}

export function MessageSpeakerBadge({ speaker, showAvatar = false }: MessageSpeakerBadgeProps) {
  const hasAvatar = showAvatar && Boolean(speaker.avatarUrl);
  const hasName = Boolean(speaker.name?.trim());
  if (!hasAvatar && !hasName) return null;
  return (
    <div className="chorus-msg-speaker" data-chorus-speaker-id={speaker.id} aria-hidden="true">
      {hasAvatar && (
        <img
          className="chorus-speaker-avatar"
          src={speaker.avatarUrl}
          alt=""
        />
      )}
      {hasName && <span className="chorus-speaker-name">{speaker.name}</span>}
    </div>
  );
}
