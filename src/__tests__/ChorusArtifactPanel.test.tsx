import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChorusArtifactPanel } from '../components/ChorusArtifactPanel';
import type { Artifact, ArtifactVersion } from '../types';

// React artifact that crashes on the "boom" content and renders otherwise —
// the bad-version / transient-crash shape from the bug report.
function FlakyArtifact({ content }: { content: string }): React.ReactElement {
  if (content === 'boom') throw new Error('artifact boom');
  return <div data-testid="artifact-ok">{content}</div>;
}

function reactVersion(id: string, version: number, content: string): ArtifactVersion {
  return { id, kind: 'react', title: 'Flaky', content, version, messageId: `m${version}` };
}

function makeArtifact(id: string, versions: ArtifactVersion[]): Artifact {
  return { id, kind: 'react', title: 'Flaky', versions };
}

const renderReactArtifact = (v: ArtifactVersion) => <FlakyArtifact content={v.content} />;

function renderPanel(props: { artifacts: Artifact[]; activeId: string; activeVersion: number }) {
  return render(
    <ChorusArtifactPanel
      artifacts={props.artifacts}
      activeId={props.activeId}
      activeVersion={props.activeVersion}
      onClose={() => {}}
      onChangeVersion={() => {}}
      renderReactArtifact={renderReactArtifact}
    />,
  );
}

describe('ChorusArtifactPanel React artifact boundary', () => {
  it('lets a valid later version render after an earlier version crashed', () => {
    const artifact = makeArtifact('a1', [
      reactVersion('a1', 1, 'boom'),
      reactVersion('a1', 2, 'good'),
    ]);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { rerender } = renderPanel({ artifacts: [artifact], activeId: 'a1', activeVersion: 1 });
      // v1 crashed → placeholder.
      expect(screen.getByText(/React artifact failed to render: artifact boom/)).toBeInTheDocument();
      expect(screen.queryByTestId('artifact-ok')).toBeNull();

      // Switch to the valid v2: the boundary must reset and render it.
      rerender(
        <ChorusArtifactPanel
          artifacts={[artifact]}
          activeId="a1"
          activeVersion={2}
          onClose={() => {}}
          onChangeVersion={() => {}}
          renderReactArtifact={renderReactArtifact}
        />,
      );
      expect(screen.queryByText(/React artifact failed to render/)).toBeNull();
      expect(screen.getByTestId('artifact-ok')).toHaveTextContent('good');
    } finally {
      spy.mockRestore();
    }
  });

  it('recovers when switching to a different valid artifact after a crash', () => {
    const bad = makeArtifact('bad', [reactVersion('bad', 1, 'boom')]);
    const ok = makeArtifact('ok', [reactVersion('ok', 1, 'fine')]);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { rerender } = renderPanel({ artifacts: [bad, ok], activeId: 'bad', activeVersion: 1 });
      expect(screen.getByText(/React artifact failed to render/)).toBeInTheDocument();

      rerender(
        <ChorusArtifactPanel
          artifacts={[bad, ok]}
          activeId="ok"
          activeVersion={1}
          onClose={() => {}}
          onChangeVersion={() => {}}
          renderReactArtifact={renderReactArtifact}
        />,
      );
      expect(screen.queryByText(/React artifact failed to render/)).toBeNull();
      expect(screen.getByTestId('artifact-ok')).toHaveTextContent('fine');
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps the failure placeholder for repeated crashes on the same version', () => {
    const artifact = makeArtifact('a1', [reactVersion('a1', 1, 'boom')]);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { rerender } = renderPanel({ artifacts: [artifact], activeId: 'a1', activeVersion: 1 });
      expect(screen.getByText(/React artifact failed to render/)).toBeInTheDocument();

      // Re-render with the same active version: must stay on the placeholder.
      rerender(
        <ChorusArtifactPanel
          artifacts={[artifact]}
          activeId="a1"
          activeVersion={1}
          onClose={() => {}}
          onChangeVersion={() => {}}
          renderReactArtifact={renderReactArtifact}
        />,
      );
      expect(screen.getByText(/React artifact failed to render/)).toBeInTheDocument();
      expect(screen.queryByTestId('artifact-ok')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
