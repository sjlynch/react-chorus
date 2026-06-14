import React from 'react';
import type { ToolCall } from '../../types';
import { warnOnceInDev } from '../../utils/warnings';
import { DEFAULT_APPROVAL_LABELS } from '../../labels/approval';
import type { ChorusApprovalLabels } from '../../labels/types';
import { ToolApprovalContext } from './approvalContext';

function fmtJson(value: unknown): string {
  try {
    const out = JSON.stringify(value, null, 2);
    return out ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Label shape for the approval card. This is the canonical `ChorusApprovalLabels`
 * section (also reachable as `<Chorus labels={{ approval }}>`); the alias and
 * `DEFAULT_TOOL_APPROVAL_LABELS` re-export are kept for the standalone
 * `<ToolApprovalCard>` public API.
 */
export type ToolApprovalCardLabels = ChorusApprovalLabels;

export const DEFAULT_TOOL_APPROVAL_LABELS: ChorusApprovalLabels = DEFAULT_APPROVAL_LABELS;

export interface ToolApprovalCardProps {
  toolCall: ToolCall;
  /** Optional MCP server label shown next to the tool name. */
  serverName?: string;
  labels?: Partial<ToolApprovalCardLabels>;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Renders the three-button "Allow once / Allow always / Deny" approval card for
 * a tool call whose `toolCall.approval === 'pending'`. Decisions are routed
 * through the `ToolApprovalContext` so the surrounding `<Chorus>` shell can
 * persist per-tool policy and resolve the awaiting handler.
 */
export function ToolApprovalCard({ toolCall, serverName, labels, className, style }: ToolApprovalCardProps) {
  const ctx = React.useContext(ToolApprovalContext);
  const [open, setOpen] = React.useState(false);
  const bodyId = React.useId();
  const merged: ToolApprovalCardLabels = { ...DEFAULT_TOOL_APPROVAL_LABELS, ...labels };
  const id = toolCall.id;
  const name = toolCall.name;

  // Surface a dev-only warning when the card is rendered against a real
  // pending approval (it has an `id`) without a `<ToolApprovalContext.Provider>`
  // in scope. Without the provider, the Allow/Deny buttons silently no-op
  // because `respond` short-circuits below — which is impossible to debug
  // from the rendered DOM. `<Chorus>` mounts the provider for the built-in
  // shell, so this only fires for custom shells that exported the card
  // directly. `warnOnceInDev` dedupes by key so a transcript with multiple
  // pending approvals warns once per app session.
  if (!ctx && id) {
    warnOnceInDev(
      'chorus-tool-approval-card-missing-provider',
      '[react-chorus] <ToolApprovalCard> mounted without a <ToolApprovalContext.Provider>; the Allow/Deny buttons will not do anything. Wrap the surrounding tree in <ToolApprovalContext.Provider value={…}>, or mount the card inside <Chorus>.',
    );
  }

  const respond = (decision: 'allow-once' | 'allow-always' | 'deny') => {
    if (!ctx || !id) return;
    ctx.respond(id, name, decision);
  };

  const rootCls = ['chorus-tool-approval', className].filter(Boolean).join(' ');

  return (
    <div className={rootCls} style={style} role="group" aria-label={merged.title}>
      <div className="chorus-tool-approval-header">
        <span className="chorus-tool-approval-title">{merged.title}</span>
        <span className="chorus-tool-approval-name">
          {name}
          {serverName ? <span className="chorus-tool-approval-server"> {merged.serverPrefix} {serverName}</span> : null}
        </span>
      </div>
      {toolCall.input !== undefined && (
        <div className="chorus-tool-approval-input">
          <button
            type="button"
            className="chorus-tool-approval-input-toggle"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen(o => !o)}
          >
            {merged.inputLabel} {open ? '▲' : '▼'}
          </button>
          {open && (
            <pre id={bodyId} className="chorus-tool-approval-input-body">{fmtJson(toolCall.input)}</pre>
          )}
        </div>
      )}
      <div className="chorus-tool-approval-actions">
        <button
          type="button"
          className="chorus-tool-approval-btn chorus-tool-approval-btn--allow-once"
          onClick={() => respond('allow-once')}
        >
          {merged.allowOnce}
        </button>
        <button
          type="button"
          className="chorus-tool-approval-btn chorus-tool-approval-btn--allow-always"
          onClick={() => respond('allow-always')}
        >
          {merged.allowAlways}
        </button>
        <button
          type="button"
          className="chorus-tool-approval-btn chorus-tool-approval-btn--deny"
          onClick={() => respond('deny')}
        >
          {merged.deny}
        </button>
      </div>
    </div>
  );
}
