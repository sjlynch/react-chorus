import { ARTIFACT_TOOL_NAME } from '../reservedIds';
import type { Artifact, ArtifactKind, ArtifactPayload, ArtifactVersion, Message } from '../types';

const ARTIFACT_KINDS: ReadonlySet<ArtifactKind> = new Set<ArtifactKind>(['code', 'document', 'html', 'react']);

export function isArtifactPayload(value: unknown): value is ArtifactPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' && v.id.length > 0 &&
    typeof v.title === 'string' &&
    typeof v.content === 'string' &&
    typeof v.kind === 'string' && ARTIFACT_KINDS.has(v.kind as ArtifactKind) &&
    (v.language === undefined || typeof v.language === 'string')
  );
}

/**
 * Walks `messages` in order and assembles the artifact registry from any
 * `role: 'tool'` messages whose `toolCall.name === '__artifact'` and whose
 * `toolCall.input` is a valid `ArtifactPayload`. Tool calls emitted before
 * their input has streamed in are skipped silently. Versions for a given id
 * are returned in encounter order; the artifact's `kind`/`title` reflect its
 * latest version.
 */
export function extractArtifacts<TMeta>(messages: Message<TMeta>[]): Artifact[] {
  const byId = new Map<string, Artifact>();
  for (const message of messages) {
    if (message.role !== 'tool') continue;
    if (message.toolCall.name !== ARTIFACT_TOOL_NAME) continue;
    const payload = message.toolCall.input;
    if (!isArtifactPayload(payload)) continue;

    const existing = byId.get(payload.id);
    const versionNumber = (existing?.versions.length ?? 0) + 1;
    const version: ArtifactVersion = {
      ...payload,
      version: versionNumber,
      messageId: message.id,
    };
    if (existing) {
      existing.versions.push(version);
      existing.title = payload.title;
      existing.kind = payload.kind;
    } else {
      byId.set(payload.id, {
        id: payload.id,
        title: payload.title,
        kind: payload.kind,
        versions: [version],
      });
    }
  }
  return Array.from(byId.values());
}
