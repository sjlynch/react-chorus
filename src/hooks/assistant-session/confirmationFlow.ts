import { isPromiseLike } from '../../utils/async';
import { warnObserverError } from './observer';

export type ConfirmationResult = boolean | void | Promise<boolean | void>;

export type ConfirmationCommitPhase = 'sync' | 'async';

export interface ConfirmationFlowOptions {
  label: string;
  requestConfirmation: () => ConfirmationResult;
  onConfirmed: () => void;
  shouldCommit?: (phase: ConfirmationCommitPhase) => boolean;
  onPendingChange?: (pending: boolean) => void;
}

/**
 * Runs a host confirmation callback with Chorus' shared semantics:
 * `false` cancels, thrown/rejected confirmations warn and cancel, and async
 * pending flags are set only for promise-like confirmations.
 */
export function runConfirmationFlow({
  label,
  requestConfirmation,
  onConfirmed,
  shouldCommit,
  onPendingChange,
}: ConfirmationFlowOptions): void {
  let confirmation: ConfirmationResult;
  try {
    confirmation = requestConfirmation();
  } catch (error) {
    warnObserverError(label, error);
    return;
  }

  const commitIfAllowed = (phase: ConfirmationCommitPhase) => {
    if (shouldCommit?.(phase) === false) return;
    onConfirmed();
  };

  if (isPromiseLike<boolean | void>(confirmation)) {
    onPendingChange?.(true);
    Promise.resolve(confirmation)
      .then(confirmed => {
        if (confirmed === false) return;
        commitIfAllowed('async');
      })
      .catch(error => warnObserverError(label, error))
      .finally(() => onPendingChange?.(false));
    return;
  }

  if (confirmation === false) return;
  commitIfAllowed('sync');
}
