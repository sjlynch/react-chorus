import React from 'react';
import type { StorageAdapter } from '../../types';
import type {
  ChorusToolPolicy,
  ToolApprovalPolicy,
  ToolPolicyScope,
} from '../../approvals/types';
import { DEFAULT_APPROVAL_TIMEOUT_MS, RESERVED_UI_TOOL_NAMES } from '../../approvals/types';
import { useLatestRef } from '../useLatestRef';

const GLOBAL_POLICY_KEY = 'chorus:tool-policy';

function conversationPolicyKey(persistenceKey: string | undefined): string | null {
  if (!persistenceKey) return null;
  return `${persistenceKey}::tool-policy`;
}

function resolveStorageKey(scope: ToolPolicyScope, persistenceKey: string | undefined): string | null {
  if (scope === 'global') return GLOBAL_POLICY_KEY;
  if (scope === 'conversation') return conversationPolicyKey(persistenceKey);
  return null; // session: in-memory only
}

export type ApprovalResolution = 'allowed' | 'denied' | 'timed-out';

interface PendingEntry {
  resolve: (decision: ApprovalResolution) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface UseToolPolicyStoreOptions {
  policy?: ChorusToolPolicy;
  scope?: ToolPolicyScope;
  storage?: StorageAdapter | null;
  persistenceKey?: string;
  approvalTimeoutMs?: number;
}

export interface ToolPolicyStore {
  /** Resolve the effective policy for a tool name (perTool overrides default). */
  getDecision: (name: string) => ToolApprovalPolicy;
  /** Persist a per-tool override and update internal state. */
  setPerToolDecision: (name: string, decision: ToolApprovalPolicy) => void;
  /** Register a pending approval gate; resolves on `respondToApproval` or timeout. */
  requestApproval: (toolCallId: string) => Promise<ApprovalResolution>;
  /** Resolve a pending approval; returns true when an entry was matched. */
  respondToApproval: (toolCallId: string, decision: 'allowed' | 'denied') => boolean;
  /** Whether a pending approval exists for this tool-call id. */
  hasPending: (toolCallId: string) => boolean;
  /** Cancel every pending approval (resolves them as denied). Used on unmount/clear. */
  cancelAllPending: (decision?: ApprovalResolution) => void;
}

/**
 * Per-tool approval policy store with pluggable persistence scope.
 *
 * - `session` scope keeps perTool overrides in memory only.
 * - `conversation` scope writes to `${persistenceKey}::tool-policy` on the
 *   supplied `StorageAdapter` so the per-tool policy survives reload of the
 *   same conversation.
 * - `global` scope writes to a fixed key (`chorus:tool-policy`) so
 *   "Allow always" decisions follow the user across conversations.
 *
 * Pending approval gates are entirely in-memory: a reloaded `pending` row
 * cannot resolve (the awaiter is gone), so the host should ignore stale
 * pending approval state on the next session.
 */
export function useToolPolicyStore({
  policy,
  scope = 'conversation',
  storage,
  persistenceKey,
  approvalTimeoutMs = DEFAULT_APPROVAL_TIMEOUT_MS,
}: UseToolPolicyStoreOptions): ToolPolicyStore {
  const [perTool, setPerTool] = React.useState<Record<string, ToolApprovalPolicy>>({});
  const perToolRef = React.useRef(perTool);
  perToolRef.current = perTool;
  const policyRef = useLatestRef(policy);
  const storageKey = resolveStorageKey(scope, persistenceKey);
  const storageKeyRef = useLatestRef(storageKey);
  const storageRef = useLatestRef(storage ?? null);
  const timeoutRef = useLatestRef(Math.max(0, approvalTimeoutMs));
  const pendingRef = React.useRef<Map<string, PendingEntry>>(new Map());

  // Load persisted perTool overrides on key/scope change.
  React.useEffect(() => {
    if (!storageKey || !storage) {
      setPerTool({});
      return;
    }
    let cancelled = false;
    const apply = (raw: string | null) => {
      if (cancelled) return;
      if (!raw) {
        setPerTool({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const out: Record<string, ToolApprovalPolicy> = {};
          for (const [name, value] of Object.entries(parsed)) {
            if (value === 'allow' || value === 'ask' || value === 'deny') out[name] = value;
          }
          setPerTool(out);
          return;
        }
      } catch {
        // ignore malformed storage values
      }
      setPerTool({});
    };
    try {
      const result = storage.getItem(storageKey);
      if (result && typeof (result as Promise<string | null>).then === 'function') {
        (result as Promise<string | null>).then(apply, () => apply(null));
      } else {
        apply(result as string | null);
      }
    } catch {
      apply(null);
    }
    return () => { cancelled = true; };
  }, [storage, storageKey]);

  const persist = React.useCallback((next: Record<string, ToolApprovalPolicy>) => {
    const key = storageKeyRef.current;
    const adapter = storageRef.current;
    if (!key || !adapter) return;
    try {
      const empty = Object.keys(next).length === 0;
      if (empty && adapter.removeItem) {
        void adapter.removeItem(key);
        return;
      }
      void adapter.setItem(key, JSON.stringify(next));
    } catch {
      // best-effort persistence — errors are not surfaced because the in-memory
      // override already took effect and the failure is recoverable.
    }
  }, [storageKeyRef, storageRef]);

  const getDecision = React.useCallback((name: string): ToolApprovalPolicy => {
    if (RESERVED_UI_TOOL_NAMES.has(name)) return 'allow';
    const perToolOverride = perToolRef.current[name];
    if (perToolOverride) return perToolOverride;
    const fromProp = policyRef.current?.perTool?.[name];
    if (fromProp) return fromProp;
    return policyRef.current?.default ?? 'allow';
  }, [policyRef]);

  const setPerToolDecision = React.useCallback((name: string, decision: ToolApprovalPolicy) => {
    if (!name) return;
    setPerTool(prev => {
      if (prev[name] === decision) return prev;
      const next = { ...prev, [name]: decision };
      persist(next);
      return next;
    });
  }, [persist]);

  const clearPending = React.useCallback((toolCallId: string) => {
    const entry = pendingRef.current.get(toolCallId);
    if (!entry) return;
    if (entry.timer != null) clearTimeout(entry.timer);
    pendingRef.current.delete(toolCallId);
  }, []);

  const requestApproval = React.useCallback((toolCallId: string): Promise<ApprovalResolution> => {
    // Clear any stale entry for this id before creating a new one.
    clearPending(toolCallId);
    return new Promise<ApprovalResolution>(resolve => {
      const timeoutMs = timeoutRef.current;
      const entry: PendingEntry = {
        resolve: (decision) => {
          clearPending(toolCallId);
          resolve(decision);
        },
        timer: null,
      };
      if (timeoutMs > 0 && timeoutMs !== Infinity) {
        entry.timer = setTimeout(() => entry.resolve('timed-out'), timeoutMs);
      }
      pendingRef.current.set(toolCallId, entry);
    });
  }, [clearPending, timeoutRef]);

  const respondToApproval = React.useCallback((toolCallId: string, decision: 'allowed' | 'denied') => {
    const entry = pendingRef.current.get(toolCallId);
    if (!entry) return false;
    entry.resolve(decision);
    return true;
  }, []);

  const hasPending = React.useCallback((toolCallId: string) => pendingRef.current.has(toolCallId), []);

  const cancelAllPending = React.useCallback((decision: ApprovalResolution = 'denied') => {
    const entries = Array.from(pendingRef.current.values());
    pendingRef.current.clear();
    for (const entry of entries) {
      if (entry.timer != null) clearTimeout(entry.timer);
      entry.resolve(decision);
    }
  }, []);

  React.useEffect(() => () => {
    // Unmount: free pending timers; awaiters can be left to GC, since the
    // session that started them has been torn down.
    for (const entry of pendingRef.current.values()) {
      if (entry.timer != null) clearTimeout(entry.timer);
    }
    pendingRef.current.clear();
  }, []);

  return {
    getDecision,
    setPerToolDecision,
    requestApproval,
    respondToApproval,
    hasPending,
    cancelAllPending,
  };
}
