import type { ArtifactKind } from '../types';
import type { ChorusArtifactLabels } from './types';

export const DEFAULT_ARTIFACT_LABELS: ChorusArtifactLabels = {
  untitled: 'Untitled artifact',
  panelAriaLabel: (title) => `Artifact: ${title}`,
  close: 'Close artifact panel',
  previousVersion: 'Previous version',
  nextVersion: 'Next version',
  diff: 'Diff',
  copy: 'Copy',
  copied: 'Copied',
  copyFailed: 'Copy failed',
  download: 'Download',
  openInNewTab: 'Open in new tab',
  previewTitle: 'Artifact preview',
  reactPlaceholder: 'React artifacts require a host-supplied renderReactArtifact handler that routes through the block registry.',
  reactError: (message) => `React artifact failed to render: ${message}`,
  open: 'Open',
  kind: (kind: ArtifactKind) => {
    switch (kind) {
      case 'code': return 'Code';
      case 'document': return 'Document';
      case 'html': return 'HTML';
      case 'react': return 'React';
      default: return kind;
    }
  },
};
