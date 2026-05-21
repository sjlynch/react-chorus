import type { Dispatch, SetStateAction } from 'react';
import type { Message } from '../../types';
import type { PersistenceState } from './messageCodec';
import type { PendingPreloadChange } from './preloadReplay';
import type {
  InitialSyncRead,
  MutableRef,
  PendingRead,
  ReadFailurePlan,
  ReadSourcePlan,
  ReadSuccessPlan,
} from './readPlanning';
import type { ChorusPersistenceError, PersistenceOperation } from './types';

export interface ReadLifecycleEffectAdapter<TMeta = Record<string, unknown>> {
  writeVersionRef: MutableRef<number>;
  stateRef: MutableRef<PersistenceState<TMeta>>;
  setState: Dispatch<SetStateAction<PersistenceState<TMeta>>>;
  setError: Dispatch<SetStateAction<ChorusPersistenceError | null>>;
  initialAsyncReadRef: MutableRef<PendingRead | null>;
  initialSyncReadRef: MutableRef<InitialSyncRead | null>;
  pendingPreloadChangeRef: MutableRef<PendingPreloadChange<TMeta> | null>;
  queueWrite: (messages: Message<TMeta>[], version: number, flushNow: boolean, removeIfEmpty: boolean) => void;
  reportPersistenceError: (rawError: unknown, operation: PersistenceOperation, errorKey?: string) => void;
}

export function applyReadLoadingState<TMeta>(
  loadingState: PersistenceState<TMeta>,
  writeVersion: number,
  adapter: ReadLifecycleEffectAdapter<TMeta>,
) {
  adapter.setState(prev => {
    if (adapter.writeVersionRef.current !== writeVersion) return prev;
    adapter.stateRef.current = loadingState;
    return loadingState;
  });
}

export function applyReadSourcePlan<TMeta>(
  plan: ReadSourcePlan<TMeta>,
  adapter: ReadLifecycleEffectAdapter<TMeta>,
) {
  if (plan.clearPendingPreload) adapter.pendingPreloadChangeRef.current = null;

  if (plan.kind === 'disabled') {
    adapter.stateRef.current = plan.state;
    adapter.setState(plan.state);
    return;
  }

  if (plan.kind === 'use-initial-sync') {
    adapter.initialSyncReadRef.current = null;
    return;
  }

  if (plan.kind === 'use-initial-async') {
    adapter.initialAsyncReadRef.current = null;
    applyReadLoadingState(plan.loadingState, plan.pendingRead.writeVersion, adapter);
  }
}

export function applyReadSuccessPlan<TMeta>(
  plan: ReadSuccessPlan<TMeta>,
  adapter: ReadLifecycleEffectAdapter<TMeta>,
) {
  if (plan.kind === 'replay-preload') {
    adapter.pendingPreloadChangeRef.current = null;
    adapter.writeVersionRef.current = plan.write.version;
    adapter.stateRef.current = plan.state;
    adapter.setState(plan.state);
    adapter.setError(null);
    adapter.queueWrite(plan.write.messages, plan.write.version, plan.write.flushNow, plan.write.removeIfEmpty);
    return;
  }

  if (plan.clearPendingPreload) adapter.pendingPreloadChangeRef.current = null;
  adapter.stateRef.current = plan.state;
  adapter.setState(plan.state);
  if (plan.error) adapter.reportPersistenceError(plan.error, 'deserialize', plan.state.key);
  else adapter.setError(null);
}

export function applyReadFailurePlan<TMeta>(
  plan: ReadFailurePlan<TMeta>,
  adapter: ReadLifecycleEffectAdapter<TMeta>,
) {
  if (plan.clearPendingPreload) adapter.pendingPreloadChangeRef.current = null;
  adapter.stateRef.current = plan.state;
  adapter.setState(plan.state);
  adapter.reportPersistenceError(plan.error, 'read', plan.key);
}
