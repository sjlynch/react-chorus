// Pure types for tool-call approvals / per-tool policy. Importing types from
// here is a zero-runtime edge so policy-aware modules can reference them
// without dragging in the policy-store hook.

export type ToolApprovalPolicy = 'allow' | 'ask' | 'deny';
export type ToolPolicyScope = 'session' | 'conversation' | 'global';

/**
 * Policy bundle accepted by `<Chorus toolPolicy={...}>`. `default` is consulted
 * for any tool not listed in `perTool`. `perTool[name]` (when set) overrides
 * the default for that tool.
 */
export interface ChorusToolPolicy {
  default: ToolApprovalPolicy;
  perTool?: Record<string, ToolApprovalPolicy>;
}

/** Resolution of an approval-card click. */
export type ToolApprovalDecision = 'allow-once' | 'allow-always' | 'deny';

/** Default approval timeout in ms — 5 minutes. */
export const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Reserved tool names that are exempt from approval policies — they're UI-only
 * with no side effects, so blocking them would be a footgun.
 */
export const RESERVED_UI_TOOL_NAMES: ReadonlySet<string> = new Set([
  '__render_block',
  '__artifact',
  '__run_code',
]);
