import React from 'react';
import { COPY_FEEDBACK_DURATION_MS } from '../../utils/messageCopy';
import type { ChorusMessageActionLabels } from '../../labels/types';

/**
 * Copy-failure timer state machine for `MessageActions`.
 *
 * `showCopyFailed` flips `copyFailed` on and schedules a reset
 * `COPY_FEEDBACK_DURATION_MS` later. Calling it again while a reset is still
 * pending clears the prior timeout first, so each failure gets the full
 * feedback window rather than inheriting the leftover of an earlier one. The
 * pending timeout is also cleared on unmount.
 *
 * `copyLabel` is the label to surface on the copy control — the failure label
 * while `copyFailed` is set, the resting label otherwise.
 */
export function useCopyFeedback(labels: ChorusMessageActionLabels) {
  const [copyFailed, setCopyFailed] = React.useState(false);
  const copyFailureTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => {
    if (copyFailureTimerRef.current) clearTimeout(copyFailureTimerRef.current);
  }, []);

  const showCopyFailed = React.useCallback(() => {
    if (copyFailureTimerRef.current) clearTimeout(copyFailureTimerRef.current);
    setCopyFailed(true);
    copyFailureTimerRef.current = setTimeout(() => {
      setCopyFailed(false);
      copyFailureTimerRef.current = null;
    }, COPY_FEEDBACK_DURATION_MS);
  }, []);

  const copyLabel = copyFailed ? labels.copyFailed : labels.copy;

  return { copyFailed, showCopyFailed, copyLabel };
}
