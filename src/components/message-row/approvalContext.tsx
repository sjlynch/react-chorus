import React from 'react';

export interface ToolApprovalContextValue {
  /** Resolve a pending approval. `allow-always` also persists the per-tool policy. */
  respond: (toolCallId: string, toolName: string, decision: 'allow-once' | 'allow-always' | 'deny') => void;
}

export const ToolApprovalContext = React.createContext<ToolApprovalContextValue | null>(null);
