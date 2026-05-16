import type { Attachment, AttachmentUploadResult } from '../../types';

export const PENDING_ATTACHMENT_STATUS = 'uploading';
let pendingAttachmentIdCounter = 0;

// Local to keep attachment UI from owning shared hook/transport utility chunks.
function createAbortError(message: string) {
  if (typeof DOMException === 'function') return new DOMException(message, 'AbortError');
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export interface PendingAttachmentWork {
  file: File;
  pendingId: string;
  controller: AbortController;
  operation: 'read' | 'upload';
  placeholder: Attachment;
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return String(bytes);
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && size >= 1024; i += 1) {
    size /= 1024;
    unit = units[i];
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${unit}`;
}

export function matchesAccept(file: File, accept: string) {
  const rules = accept.split(',').map(rule => rule.trim().toLowerCase()).filter(Boolean);
  if (rules.length === 0) return true;

  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  return rules.some(rule => {
    if (rule === '*/*') return true;
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
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

export function createPendingAttachmentId() {
  pendingAttachmentIdCounter += 1;
  return `chorus-upload-${Date.now()}-${pendingAttachmentIdCounter}`;
}

export function getPendingAttachmentId(att: Attachment) {
  return typeof att.metadata?.pendingId === 'string' ? att.metadata.pendingId : undefined;
}

export function getPendingAttachmentOperation(att: Attachment) {
  return att.metadata?.operation === 'read' ? 'read' : 'upload';
}

export function isPendingAttachment(att: Attachment) {
  return att.metadata?.status === PENDING_ATTACHMENT_STATUS && typeof att.metadata?.pendingId === 'string';
}

export function createPendingAttachment(file: File, pendingId: string, operation: PendingAttachmentWork['operation']): Attachment {
  return {
    name: file.name,
    type: file.type,
    size: file.size,
    data: '',
    metadata: { status: PENDING_ATTACHMENT_STATUS, pendingId, operation },
  };
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
