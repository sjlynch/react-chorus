import React from 'react';
import type { Artifact, ArtifactVersion } from '../types';
import { Markdown, type MarkdownSanitizer } from './Markdown';
import { diffLines } from '../artifacts/diffVersions';
import { getHljs, highlightCode, isHljsLoaded, loadHljsTheme } from '../utils/hljsLoader';
import { joinClasses } from '../utils/className';
import { DEFAULT_ARTIFACT_LABELS } from '../labels/artifacts';
import type { ChorusArtifactLabels } from '../labels/types';

export interface ChorusArtifactPanelProps {
  /** Full artifact registry, in first-seen order. */
  artifacts: Artifact[];
  /** Active artifact id, or null when the panel is closed. */
  activeId: string | null;
  /** 1-based active version number for `activeId`. */
  activeVersion: number;
  /** Triggered when the close button is pressed. */
  onClose: () => void;
  /** Change the active version for the open artifact. */
  onChangeVersion: (version: number) => void;
  codeTheme?: 'dark' | 'light';
  markdownSanitizer?: MarkdownSanitizer;
  /**
   * Render a `react` artifact through a host-supplied block registry. When
   * omitted, the panel falls back to a placeholder so the body never crashes.
   * Pairs with the Generative-UI block registry task.
   */
  renderReactArtifact?: (version: ArtifactVersion) => React.ReactNode;
  /** Class name applied to the panel root. */
  className?: string;
  /**
   * Partial overrides for the panel's built-in strings (title fallback,
   * version/diff/copy/download actions, react placeholder/error, …). Omitted
   * keys fall back to the English defaults. `<Chorus>` forwards
   * `labels.artifacts` here automatically.
   */
  labels?: Partial<ChorusArtifactLabels>;
}

interface KindBodyProps {
  version: ArtifactVersion;
  codeTheme: 'dark' | 'light';
  markdownSanitizer?: MarkdownSanitizer;
  renderReactArtifact?: (version: ArtifactVersion) => React.ReactNode;
  labels: ChorusArtifactLabels;
}

function CodeBody({ version, codeTheme }: { version: ArtifactVersion; codeTheme: 'dark' | 'light' }) {
  const [, setReady] = React.useState(isHljsLoaded());
  React.useEffect(() => {
    let cancelled = false;
    void loadHljsTheme(codeTheme).catch(() => undefined);
    void getHljs()
      .then(() => { if (!cancelled) setReady(true); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [codeTheme]);
  const html = isHljsLoaded() ? highlightCode(version.content, version.language) : null;
  if (html) {
    return (
      <pre className={joinClasses('chorus-artifact-code', 'hljs')}>
        {/* highlight.js returns a sanitized HTML string */}
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    );
  }
  return (
    <pre className="chorus-artifact-code"><code>{version.content}</code></pre>
  );
}

function HtmlBody({ version, labels }: { version: ArtifactVersion; labels: ChorusArtifactLabels }) {
  // Sandboxed iframe — `allow-scripts` *without* `allow-same-origin` means the
  // iframe runs as a unique origin, so `window.parent` / `top` are blocked from
  // touching this document by the same-origin policy. We build the iframe via
  // `srcDoc` so the host page never needs to ship a separate scaffold file.
  return (
    <iframe
      className="chorus-artifact-iframe"
      sandbox="allow-scripts"
      srcDoc={version.content}
      title={version.title || labels.previewTitle}
    />
  );
}

function DocumentBody({ version, markdownSanitizer, codeTheme }: { version: ArtifactVersion; markdownSanitizer?: MarkdownSanitizer; codeTheme: 'dark' | 'light' }) {
  return (
    <div className="chorus-artifact-doc">
      <Markdown text={version.content} codeTheme={codeTheme} sanitizer={markdownSanitizer} />
    </div>
  );
}

function ReactBody({ version, renderReactArtifact, labels }: { version: ArtifactVersion; renderReactArtifact?: (v: ArtifactVersion) => React.ReactNode; labels: ChorusArtifactLabels }) {
  if (!renderReactArtifact) {
    return (
      <div className="chorus-artifact-placeholder">
        <p>{labels.reactPlaceholder}</p>
      </div>
    );
  }
  // Key the boundary on the artifact identity (id), the active version, and its
  // content. When the reader switches artifacts/versions — or a streaming
  // version finishes — a crash from one version no longer poisons the next.
  const resetKey = `${version.id} ${version.version} ${version.content}`;
  return (
    <ArtifactErrorBoundary resetKey={resetKey} errorLabel={labels.reactError}>
      <div className="chorus-artifact-react">{renderReactArtifact(version)}</div>
    </ArtifactErrorBoundary>
  );
}

class ArtifactErrorBoundary extends React.Component<{ resetKey: string; children: React.ReactNode; errorLabel: (message: string) => string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prevProps: { resetKey: string }) {
    // Clear a latched error only when the rendered version actually changed, so
    // a bad v1 (or a transient crash) stops blocking a valid v2 while repeated
    // failures on the same version keep showing the placeholder.
    if (this.state.error !== null && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }
  render() {
    if (this.state.error) {
      return <div className="chorus-artifact-placeholder">{this.props.errorLabel(this.state.error.message)}</div>;
    }
    return this.props.children;
  }
}

function ArtifactBody({ version, codeTheme, markdownSanitizer, renderReactArtifact, labels }: KindBodyProps) {
  switch (version.kind) {
    case 'code': return <CodeBody version={version} codeTheme={codeTheme} />;
    case 'document': return <DocumentBody version={version} codeTheme={codeTheme} markdownSanitizer={markdownSanitizer} />;
    case 'html': return <HtmlBody version={version} labels={labels} />;
    case 'react': return <ReactBody version={version} renderReactArtifact={renderReactArtifact} labels={labels} />;
  }
}

function DiffBody({ from, to }: { from: ArtifactVersion; to: ArtifactVersion }) {
  const lines = React.useMemo(() => diffLines(from.content, to.content), [from.content, to.content]);
  return (
    <pre className="chorus-artifact-diff">
      {lines.map((line, idx) => (
        <div key={idx} className={`chorus-artifact-diff-line chorus-artifact-diff-${line.kind}`}>
          <span className="chorus-artifact-diff-marker">
            {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
          </span>
          {line.text}
        </div>
      ))}
    </pre>
  );
}

function downloadArtifact(version: ArtifactVersion) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([version.content], { type: version.kind === 'html' ? 'text/html' : 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ext = version.kind === 'html' ? 'html' : version.language ?? (version.kind === 'document' ? 'md' : 'txt');
  const safeTitle = (version.title || 'artifact').replace(/[^a-z0-9-_]+/gi, '-').slice(0, 64) || 'artifact';
  a.download = `${safeTitle}.v${version.version}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function openInNewTab(version: ArtifactVersion) {
  if (typeof window === 'undefined') return;
  // HTML artifacts are intentionally unsupported here: a new tab would run the
  // model-generated HTML in the host origin (with cookies, localStorage, and
  // same-origin fetch), bypassing the `sandbox="allow-scripts"` isolation that
  // `HtmlBody` applies in-panel. The in-panel iframe already renders the HTML
  // safely, and `Download` still produces a standalone `.html` file.
  if (version.kind === 'html') return;
  const blob = new Blob([version.content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function copyArtifact(version: ArtifactVersion): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return Promise.resolve(false);
  return navigator.clipboard.writeText(version.content).then(() => true, () => false);
}

/**
 * Slide-in side panel that renders the active artifact. Routes per-kind:
 * code via highlight.js, document via the shared Markdown pipeline, html in a
 * sandboxed iframe (`allow-scripts` only, no `allow-same-origin`), react via
 * the host-supplied block registry behind an error boundary. The header shows
 * a version switcher and Copy/Download/Open-in-new-tab/Close actions; a Diff
 * toggle compares the active version with the previous one. Open-in-new-tab
 * is hidden for `kind: 'html'` artifacts because a new tab would run model-
 * generated HTML in the host origin, bypassing the iframe sandbox; download
 * the artifact and open the file locally for a standalone view.
 */
export function ChorusArtifactPanel({
  artifacts,
  activeId,
  activeVersion,
  onClose,
  onChangeVersion,
  codeTheme = 'dark',
  markdownSanitizer,
  renderReactArtifact,
  className,
  labels,
}: ChorusArtifactPanelProps) {
  const L = labels ? { ...DEFAULT_ARTIFACT_LABELS, ...labels } : DEFAULT_ARTIFACT_LABELS;
  const [showDiff, setShowDiff] = React.useState(false);
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle');

  React.useEffect(() => {
    setShowDiff(false);
    setCopyState('idle');
  }, [activeId]);

  if (activeId === null) return null;
  const artifact = artifacts.find(a => a.id === activeId);
  if (!artifact) return null;
  const version = artifact.versions[activeVersion - 1] ?? artifact.versions[artifact.versions.length - 1];
  if (!version) return null;

  const prev = activeVersion > 1 ? artifact.versions[activeVersion - 2] : null;
  const canPrev = activeVersion > 1;
  const canNext = activeVersion < artifact.versions.length;

  const onCopy = async () => {
    const ok = await copyArtifact(version);
    setCopyState(ok ? 'copied' : 'failed');
    setTimeout(() => setCopyState('idle'), 2000);
  };

  return (
    <aside
      className={joinClasses('chorus-artifact-panel', className)}
      role="complementary"
      aria-label={L.panelAriaLabel(artifact.title || L.untitled)}
    >
      <header className="chorus-artifact-header">
        <div className="chorus-artifact-header-title-row">
          <h3 className="chorus-artifact-title">{artifact.title || L.untitled}</h3>
          <button
            type="button"
            className="chorus-artifact-close"
            onClick={onClose}
            aria-label={L.close}
          >×</button>
        </div>
        <div className="chorus-artifact-header-controls">
          <div className="chorus-artifact-version-switcher">
            <button
              type="button"
              className="chorus-artifact-version-btn"
              onClick={() => onChangeVersion(activeVersion - 1)}
              disabled={!canPrev}
              aria-label={L.previousVersion}
            >◀</button>
            <span className="chorus-artifact-version-label">
              {activeVersion}/{artifact.versions.length}
            </span>
            <button
              type="button"
              className="chorus-artifact-version-btn"
              onClick={() => onChangeVersion(activeVersion + 1)}
              disabled={!canNext}
              aria-label={L.nextVersion}
            >▶</button>
          </div>
          <div className="chorus-artifact-actions">
            {prev && (
              <button
                type="button"
                className={joinClasses('chorus-artifact-action', showDiff && 'chorus-artifact-action--active')}
                onClick={() => setShowDiff(s => !s)}
                aria-pressed={showDiff}
              >{L.diff}</button>
            )}
            <button
              type="button"
              className="chorus-artifact-action"
              onClick={onCopy}
            >
              {copyState === 'copied' ? L.copied : copyState === 'failed' ? L.copyFailed : L.copy}
            </button>
            <button
              type="button"
              className="chorus-artifact-action"
              onClick={() => downloadArtifact(version)}
            >{L.download}</button>
            {version.kind !== 'html' && (
              <button
                type="button"
                className="chorus-artifact-action"
                onClick={() => openInNewTab(version)}
              >{L.openInNewTab}</button>
            )}
          </div>
        </div>
      </header>
      <div className="chorus-artifact-body">
        {showDiff && prev ? (
          <DiffBody from={prev} to={version} />
        ) : (
          <ArtifactBody
            version={version}
            codeTheme={codeTheme}
            markdownSanitizer={markdownSanitizer}
            renderReactArtifact={renderReactArtifact}
            labels={L}
          />
        )}
      </div>
    </aside>
  );
}
