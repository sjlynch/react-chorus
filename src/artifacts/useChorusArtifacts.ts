import React from 'react';
import type { Artifact, ArtifactVersion, Message } from '../types';
import { extractArtifacts } from './extractArtifacts';

export interface ChorusArtifactsState {
  /** Registry of artifacts emitted so far, in first-seen order. */
  artifacts: Artifact[];
  /** Artifact id currently shown in the side panel, or null when closed. */
  activeId: string | null;
  /** Version number (1-based) currently shown for `activeId`. */
  activeVersion: number;
  /** Whether the side panel is open. */
  open: boolean;
  openArtifact: (id: string, version?: number) => void;
  closeArtifact: () => void;
  setActiveVersion: (version: number) => void;
  /** Convenience: look up an artifact by id. */
  getArtifact: (id: string) => Artifact | undefined;
  /** Convenience: look up a specific version by 1-based number. */
  getVersion: (id: string, version: number) => ArtifactVersion | undefined;
}

/**
 * Aggregates `__artifact` tool messages into the artifact registry and tracks
 * panel open / active-version state. Pure derivation from `messages` plus
 * local UI state — does not mutate the transcript.
 */
export function useChorusArtifacts<TMeta>(messages: Message<TMeta>[]): ChorusArtifactsState {
  const artifacts = React.useMemo(() => extractArtifacts(messages), [messages]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [activeVersion, setActiveVersionState] = React.useState<number>(1);

  // If the active artifact disappears (e.g. after a clear), close the panel.
  React.useEffect(() => {
    if (activeId === null) return;
    const exists = artifacts.some(a => a.id === activeId);
    if (!exists) {
      setActiveId(null);
      setActiveVersionState(1);
    }
  }, [activeId, artifacts]);

  const openArtifact = React.useCallback((id: string, version?: number) => {
    setActiveId(id);
    setActiveVersionState(version ?? Number.POSITIVE_INFINITY);
  }, []);

  const closeArtifact = React.useCallback(() => {
    setActiveId(null);
  }, []);

  const setActiveVersion = React.useCallback((version: number) => {
    setActiveVersionState(version);
  }, []);

  const artifactsById = React.useMemo(() => {
    const map = new Map<string, Artifact>();
    for (const artifact of artifacts) map.set(artifact.id, artifact);
    return map;
  }, [artifacts]);

  const getArtifact = React.useCallback((id: string) => artifactsById.get(id), [artifactsById]);
  const getVersion = React.useCallback((id: string, version: number) => {
    const artifact = artifactsById.get(id);
    if (!artifact) return undefined;
    return artifact.versions[version - 1];
  }, [artifactsById]);

  // Clamp activeVersion to the artifact's current version count so an
  // openArtifact(Infinity) call settles on the latest version, and follow-up
  // versions slide the panel forward automatically when the reader is already
  // pinned to the latest.
  const activeArtifact = activeId === null ? undefined : artifactsById.get(activeId);
  const clampedVersion = activeArtifact
    ? Math.min(Math.max(1, activeVersion), activeArtifact.versions.length)
    : activeVersion;

  return {
    artifacts,
    activeId,
    activeVersion: clampedVersion,
    open: activeId !== null,
    openArtifact,
    closeArtifact,
    setActiveVersion,
    getArtifact,
    getVersion,
  };
}
