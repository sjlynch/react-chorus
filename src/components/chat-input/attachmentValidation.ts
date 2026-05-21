import type { AttachmentError, AttachmentErrorReason, AttachmentSource } from '../../types';
import type { ChorusAttachmentLabels } from '../../labels/types';
import type { PendingAttachmentOperation } from './attachmentUtils';

const BYTES_PER_UNIT = 1024;
const FIXED_DECIMAL_THRESHOLD = 10;

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return String(bytes);
  if (bytes < BYTES_PER_UNIT) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = bytes / BYTES_PER_UNIT;
  let unit = units[0];
  for (let i = 1; i < units.length && size >= BYTES_PER_UNIT; i += 1) {
    size /= BYTES_PER_UNIT;
    unit = units[i];
  }
  return `${size.toFixed(size >= FIXED_DECIMAL_THRESHOLD ? 0 : 1)} ${unit}`;
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

interface AttachmentErrorOptions {
  reason: AttachmentErrorReason;
  source: AttachmentSource;
  file: File | undefined;
  message: string;
  accept?: string;
  maxAttachmentBytes?: number;
  maxAttachments?: number;
}

export function createAttachmentError({
  reason,
  source,
  file,
  message,
  accept,
  maxAttachmentBytes,
  maxAttachments,
}: AttachmentErrorOptions): AttachmentError {
  return {
    reason,
    message,
    file,
    source,
    accept,
    maxAttachmentBytes,
    maxAttachments,
  };
}

interface AttachmentLimits {
  accept?: string;
  maxAttachmentBytes?: number;
  maxAttachments?: number;
}

interface ValidateAttachmentBatchOptions extends AttachmentLimits {
  files: File[];
  source: AttachmentSource;
  currentAttachmentCount: number;
  labels: ChorusAttachmentLabels;
}

export function validateAttachmentBatch({
  files,
  source,
  currentAttachmentCount,
  labels,
  accept,
  maxAttachmentBytes,
  maxAttachments,
}: ValidateAttachmentBatchOptions) {
  const acceptedFiles: File[] = [];
  const errors: AttachmentError[] = [];
  let nextCount = currentAttachmentCount;

  for (const file of files) {
    if (!matchesAccept(file, accept ?? '')) {
      errors.push(createAttachmentError({
        reason: 'unsupported-type',
        source,
        file,
        accept,
        maxAttachmentBytes,
        maxAttachments,
        message: labels.unsupportedTypeError({ name: file.name, accept }),
      }));
      continue;
    }

    // `maxAttachmentBytes` of 0 (or negative) means "no files allowed" rather
    // than "unlimited" — reject every file, including empty ones.
    if (maxAttachmentBytes !== undefined && (maxAttachmentBytes <= 0 || file.size > maxAttachmentBytes)) {
      errors.push(createAttachmentError({
        reason: 'too-large',
        source,
        file,
        accept,
        maxAttachmentBytes,
        maxAttachments,
        message: labels.tooLargeError({
          name: file.name,
          size: formatBytes(file.size),
          limit: formatBytes(maxAttachmentBytes),
        }),
      }));
      continue;
    }

    if (maxAttachments !== undefined && nextCount >= maxAttachments) {
      errors.push(createAttachmentError({
        reason: 'too-many',
        source,
        file,
        accept,
        maxAttachmentBytes,
        maxAttachments,
        message: labels.tooManyError({ name: file.name, max: maxAttachments }),
      }));
      continue;
    }

    nextCount += 1;
    acceptedFiles.push(file);
  }

  return { acceptedFiles, errors };
}

interface AttachmentWorkErrorOptions extends AttachmentLimits {
  operation: PendingAttachmentOperation;
  source: AttachmentSource;
  file: File;
  detail: string;
  labels: ChorusAttachmentLabels;
}

export function createAttachmentWorkError({
  operation,
  source,
  file,
  detail,
  labels,
  accept,
  maxAttachmentBytes,
  maxAttachments,
}: AttachmentWorkErrorOptions) {
  const reason = operation === 'upload' ? 'upload-failed' : 'read-failed';
  const message = operation === 'upload'
    ? labels.uploadFailedError({ name: file.name, detail })
    : labels.readFailedError({ name: file.name, detail });

  return createAttachmentError({
    reason,
    source,
    file,
    message,
    accept,
    maxAttachmentBytes,
    maxAttachments,
  });
}
