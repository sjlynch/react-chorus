import type { Attachment, AttachmentSource, AttachmentUploadResult } from '../../types';

let attachmentUidCounter = 0;

// Local to keep attachment UI from owning shared hook/transport utility chunks.
function createAbortError(message: string) {
  if (typeof DOMException === 'function') return new DOMException(message, 'AbortError');
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export type PendingAttachmentOperation = 'read' | 'upload';

/** Lifecycle state of a composer attachment. */
export type QueuedAttachmentStatus =
  /** File read/upload work is in flight. */
  | 'pending'
  /** Work succeeded; `attachment` is sendable. */
  | 'ready'
  /** Work failed; the chip stays visible so the user can retry or remove it. */
  | 'failed';

/**
 * One composer attachment plus its stable client identity and lifecycle state.
 *
 * The `uid` is assigned once at ingestion and preserved across
 * `pending → ready` / `pending → failed` transitions and retries. Chips are
 * keyed on it and remove/alt-edit/retry operations target it, so async
 * resolution (which can reorder or drop entries) never aims an action at the
 * wrong attachment. `uid` is intentionally kept off the public `Attachment`
 * payload surfaced to `onSend`.
 */
export interface QueuedAttachment {
  /** Stable client-side identity; never an array index. */
  uid: string;
  /** Current lifecycle state. */
  status: QueuedAttachmentStatus;
  /** Whether the underlying work is a default file read or a host upload. */
  operation: PendingAttachmentOperation;
  /** Where the file arrived from; retained so a retry reports errors with the original source. */
  source: AttachmentSource;
  /** The original File, retained so a cancelled or failed chip can be retried. */
  file: File;
  /** The sendable payload: a placeholder while `pending`/`failed`, the real attachment once `ready`. */
  attachment: Attachment;
}

export function readFileAsDataURL(file: File, signal: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError(`Reading ${file.name} was cancelled.`));
      return;
    }

    const reader = new FileReader();
    let settled = false;

    const cleanup = () => signal.removeEventListener('abort', abortRead);
    const settleResolve = (value: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const settleReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const rejectAbort = () => settleReject(createAbortError(`Reading ${file.name} was cancelled.`));
    const abortRead = () => {
      try {
        if (reader.readyState === FileReader.LOADING) reader.abort();
      } catch {
        // Ignore FileReader implementations that throw during abort; the promise still rejects below.
      }
      rejectAbort();
    };

    reader.onload = () => {
      if (typeof reader.result === 'string') settleResolve(reader.result);
      else settleReject(new Error(`Unable to read ${file.name} as a data URL.`));
    };
    reader.onerror = () => settleReject(reader.error ?? new Error(`Unable to read ${file.name}.`));
    reader.onabort = rejectAbort;

    signal.addEventListener('abort', abortRead, { once: true });

    try {
      reader.readAsDataURL(file);
    } catch (error) {
      settleReject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function normalizeAttachment(file: File, result: AttachmentUploadResult): Attachment {
  const data = result.data ?? result.url ?? result.id ?? '';

  return {
    ...result,
    name: result.name || file.name,
    type: result.type || file.type,
    size: typeof result.size === 'number' ? result.size : file.size,
    data,
  };
}

/** Mints a fresh stable client uid for a newly ingested attachment. */
export function createAttachmentUid() {
  attachmentUidCounter += 1;
  return `chorus-att-${Date.now()}-${attachmentUidCounter}`;
}

/** Builds the non-sendable attachment payload shown by a `pending`/`failed` chip. */
export function createPlaceholderAttachment(file: File): Attachment {
  return { name: file.name, type: file.type, size: file.size, data: '' };
}

/**
 * Returns a copy of `list` with the entry matching `uid` transformed by `update`.
 * Returns the original array reference when no entry matches so callers can skip
 * a re-render after the targeted chip was already removed/cleared.
 */
export function updateQueuedAttachment(
  list: QueuedAttachment[],
  uid: string,
  update: (item: QueuedAttachment) => QueuedAttachment,
): QueuedAttachment[] {
  let changed = false;
  const next = list.map(item => {
    if (item.uid !== uid) return item;
    changed = true;
    return update(item);
  });
  return changed ? next : list;
}

export function listFiles(files: FileList | File[] | null | undefined) {
  return files ? Array.from(files) : [];
}

export function transferHasFiles(transfer: DataTransfer) {
  const types = Array.from(transfer.types ?? []);
  if (types.includes('Files')) return true;

  const items = Array.from(transfer.items ?? []);
  return items.some(item => item.kind === 'file');
}

export function filesFromTransfer(transfer: DataTransfer) {
  const files = listFiles(transfer.files);
  if (files.length > 0) return files;

  return Array.from(transfer.items ?? [])
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null);
}
