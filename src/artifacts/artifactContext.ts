import React from 'react';
import type { Artifact } from '../types';

/**
 * Minimal handle that the default `ArtifactCard` (and any host renderer that
 * wants to surface artifacts) uses to open the side panel and look up the
 * version of an artifact emitted by a specific tool message. The provider is
 * wired up by `<Chorus>` and exposed via `ChorusArtifactContext.Provider` for
 * custom shells that want to use the panel + card without the full widget.
 */
export interface ChorusArtifactHandle {
  openArtifact: (id: string, version?: number) => void;
  /** Look up an artifact's full version history by id. */
  getArtifact: (id: string) => Artifact | undefined;
  /**
   * Find the version of `artifactId` emitted by tool message `messageId`.
   * Returns the 1-based version number when matched, or `null` if no version
   * recorded against this message id (e.g. the tool call is still streaming
   * before its payload finished).
   */
  getMessageVersion: (artifactId: string, messageId: string) => number | null;
}

export const ChorusArtifactContext = React.createContext<ChorusArtifactHandle | null>(null);

export function useChorusArtifactHandle(): ChorusArtifactHandle | null {
  return React.useContext(ChorusArtifactContext);
}
