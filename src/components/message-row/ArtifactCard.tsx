import { useChorusArtifactHandle } from '../../artifacts/artifactContext';
import type { ArtifactKind } from '../../types';
import { DEFAULT_ARTIFACT_LABELS } from '../../labels/artifacts';
import type { ChorusArtifactLabels } from '../../labels/types';

export interface ArtifactCardProps {
  id: string;
  kind: ArtifactKind;
  title: string;
  /**
   * Optional explicit version. Defaults to looking the version up through the
   * `ChorusArtifactContext` registry by the carrying tool message id; falls
   * back to 1 when no context is wired (custom shells).
   */
  version?: number;
  /**
   * Tool message id that emitted this artifact. Used to look up the version
   * number via the artifact context so the card stays in sync as new versions
   * arrive without the host needing to pass a version explicitly.
   */
  messageId?: string;
  /** Optional override for the open-button text. Takes precedence over `labels.open`. */
  openLabel?: string;
  /**
   * Partial overrides for the card's strings (title fallback, per-kind label,
   * open button). Omitted keys fall back to the English defaults. `<Chorus>`
   * forwards `labels.artifacts` here automatically.
   */
  labels?: Partial<ChorusArtifactLabels>;
}

/**
 * Inline card rendered in the transcript when an assistant turn produced an
 * artifact (long generated code/document/HTML/React UI). Clicking the card
 * routes through the `ChorusArtifactContext` handle and opens the side panel.
 * If no handle is wired (e.g. used outside `<Chorus>`), the card stays
 * non-interactive so it never throws.
 */
export function ArtifactCard({ id, kind, title, version, messageId, openLabel, labels }: ArtifactCardProps) {
  const L = labels ? { ...DEFAULT_ARTIFACT_LABELS, ...labels } : DEFAULT_ARTIFACT_LABELS;
  const handle = useChorusArtifactHandle();
  const resolvedVersion = version
    ?? (messageId && handle ? handle.getMessageVersion(id, messageId) ?? undefined : undefined)
    ?? 1;
  const onOpen = handle ? () => handle.openArtifact(id, resolvedVersion) : undefined;
  return (
    <div className="chorus-artifact-card" data-chorus-artifact-id={id} data-chorus-artifact-kind={kind}>
      <div className="chorus-artifact-card-body">
        <div className="chorus-artifact-card-title">{title || L.untitled}</div>
        <div className="chorus-artifact-card-meta">
          <span className="chorus-artifact-card-kind">{L.kind(kind)}</span>
          {resolvedVersion > 1 && <span className="chorus-artifact-card-version">v{resolvedVersion}</span>}
        </div>
      </div>
      <button
        type="button"
        className="chorus-artifact-card-open"
        onClick={onOpen}
        disabled={!onOpen}
      >
        {openLabel ?? L.open}
      </button>
    </div>
  );
}
