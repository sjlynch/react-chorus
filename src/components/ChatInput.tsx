import React from 'react';
import { ArrowUp, Paperclip, X } from 'lucide-react';
import { getAttachmentPreviewSource } from '../utils/attachmentPreview';
import type {
  Attachment,
  AttachmentError,
  AttachmentErrorReason,
  AttachmentSource,
  AttachmentUploadResult,
  UploadAttachment,
} from '../types';

const MAX_HEIGHT = 160;
const PENDING_ATTACHMENT_STATUS = 'uploading';
let pendingAttachmentIdCounter = 0;

export interface ChatInputProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value: string;
  onChange: (v: string) => void;
  onSend: (attachments: Attachment[]) => void;
  onStop?: () => void;
  placeholder?: string;
  sending?: boolean;
  /** Disable every composer affordance except Stop while a send is active. */
  disabled?: boolean;
  /** Keep the composer visible but prevent changing text, attachments, or sending. */
  readOnly?: boolean;
  /** Optional explanation surfaced as placeholder/title/description when disabled or read-only. */
  disabledReason?: string;
  /** Increment or change to clear composer attachments and cancel pending file work. */
  resetKey?: unknown;
  accept?: string;
  maxAttachmentBytes?: number;
  maxAttachments?: number;
  onAttachmentError?: (error: AttachmentError) => void;
  uploadAttachment?: UploadAttachment;
}

interface PendingAttachmentWork {
  file: File;
  pendingId: string;
  controller: AbortController;
  operation: 'read' | 'upload';
  placeholder: Attachment;
}

function formatBytes(bytes: number) {
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

function matchesAccept(file: File, accept: string) {
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

function createAbortError(message: string) {
  if (typeof DOMException === 'function') return new DOMException(message, 'AbortError');
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown) {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

function readFileAsDataURL(file: File, signal: AbortSignal) {
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

function normalizeAttachment(file: File, result: AttachmentUploadResult): Attachment {
  const data = result.data ?? result.url ?? result.id ?? '';

  return {
    ...result,
    name: result.name || file.name,
    type: result.type || file.type,
    size: typeof result.size === 'number' ? result.size : file.size,
    data,
  };
}

function createPendingAttachmentId() {
  pendingAttachmentIdCounter += 1;
  return `chorus-upload-${Date.now()}-${pendingAttachmentIdCounter}`;
}

function getPendingAttachmentId(att: Attachment) {
  return typeof att.metadata?.pendingId === 'string' ? att.metadata.pendingId : undefined;
}

function getPendingAttachmentOperation(att: Attachment) {
  return att.metadata?.operation === 'read' ? 'read' : 'upload';
}

function isPendingAttachment(att: Attachment) {
  return att.metadata?.status === PENDING_ATTACHMENT_STATUS && typeof att.metadata?.pendingId === 'string';
}

function createPendingAttachment(file: File, pendingId: string, operation: PendingAttachmentWork['operation']): Attachment {
  return {
    name: file.name,
    type: file.type,
    size: file.size,
    data: '',
    metadata: { status: PENDING_ATTACHMENT_STATUS, pendingId, operation },
  };
}

function listFiles(files: FileList | File[] | null | undefined) {
  return files ? Array.from(files) : [];
}

function transferHasFiles(transfer: DataTransfer) {
  const types = Array.from(transfer.types ?? []);
  if (types.includes('Files')) return true;

  const items = Array.from(transfer.items ?? []);
  return items.some(item => item.kind === 'file');
}

function filesFromTransfer(transfer: DataTransfer) {
  const files = listFiles(transfer.files);
  if (files.length > 0) return files;

  return Array.from(transfer.items ?? [])
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null);
}

export const ChatInput = React.forwardRef<HTMLDivElement, ChatInputProps>(function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  placeholder,
  sending,
  disabled = false,
  readOnly = false,
  disabledReason,
  resetKey,
  accept,
  maxAttachmentBytes,
  maxAttachments,
  onAttachmentError,
  uploadAttachment,
  className,
  style,
  onPaste: onPasteProp,
  onDragEnter: onDragEnterProp,
  onDragOver: onDragOverProp,
  onDragLeave: onDragLeaveProp,
  onDrop: onDropProp,
  ...rest
}: ChatInputProps, ref) {
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const [draggingFiles, setDraggingFiles] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const attachmentsRef = React.useRef(attachments);
  const dragDepthRef = React.useRef(0);
  const pendingControllersRef = React.useRef<Map<string, AbortController>>(new Map());
  const previousResetKeyRef = React.useRef(resetKey);
  const reasonId = React.useId();

  React.useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const abortPendingAttachment = React.useCallback((pendingId: string) => {
    const controller = pendingControllersRef.current.get(pendingId);
    if (controller && !controller.signal.aborted) controller.abort();
    pendingControllersRef.current.delete(pendingId);
  }, []);

  const abortAllPendingAttachments = React.useCallback(() => {
    for (const controller of pendingControllersRef.current.values()) {
      if (!controller.signal.aborted) controller.abort();
    }
    pendingControllersRef.current.clear();
  }, []);

  const clearAttachmentsAndPendingWork = React.useCallback(() => {
    abortAllPendingAttachments();
    setAttachments([]);
  }, [abortAllPendingAttachments]);

  React.useEffect(() => () => abortAllPendingAttachments(), [abortAllPendingAttachments]);

  React.useEffect(() => {
    if (Object.is(previousResetKeyRef.current, resetKey)) return;
    previousResetKeyRef.current = resetKey;
    clearAttachmentsAndPendingWork();
  }, [clearAttachmentsAndPendingWork, resetKey]);

  React.useEffect(() => {
    if (!disabled && !readOnly) return;
    abortAllPendingAttachments();
    dragDepthRef.current = 0;
    setDraggingFiles(false);
    setAttachments(prev => prev.filter(att => !isPendingAttachment(att)));
  }, [abortAllPendingAttachments, disabled, readOnly]);

  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + 'px';
  }, [value]);

  React.useImperativeHandle(ref, () => {
    const root = rootRef.current!;
    const focusTextarea = () => textareaRef.current?.focus();
    try {
      Object.defineProperty(root, 'focus', { value: focusTextarea, configurable: true });
    } catch {
      root.focus = focusTextarea;
    }
    return root;
  });

  const hasPendingAttachments = attachments.some(isPendingAttachment);
  const hasSendableAttachment = attachments.some(att => !isPendingAttachment(att));
  const composerInactive = disabled || readOnly;
  const canSend = !composerInactive && (value.trim().length > 0 || hasSendableAttachment) && !hasPendingAttachments;
  const showAttachBtn = accept !== undefined;
  const canIngestFiles = showAttachBtn && !composerInactive;
  const stopAvailable = Boolean(sending && onStop);
  const inactiveReason = disabledReason || (readOnly ? 'Composer is read-only.' : disabled ? 'Composer is disabled.' : undefined);
  const placeholderText = inactiveReason || placeholder || 'Send a message';

  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + 'px';
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (composerInactive) return;
    onChange(e.target.value);
    resizeTextarea();
  };

  const handleSend = () => {
    if (!canSend) return;
    onSend(attachments.filter(att => !isPendingAttachment(att)));
    clearAttachmentsAndPendingWork();
    const el = textareaRef.current;
    if (el) el.style.height = '';
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sending && canSend) handleSend();
    }
  };

  const handleClick = () => {
    if (sending) {
      onStop?.();
    } else if (canSend) {
      handleSend();
    }
  };

  const reportAttachmentError = React.useCallback((
    reason: AttachmentErrorReason,
    source: AttachmentSource,
    file: File | undefined,
    message: string,
  ) => {
    onAttachmentError?.({
      reason,
      message,
      file,
      source,
      accept,
      maxAttachmentBytes,
      maxAttachments,
    });
  }, [accept, maxAttachmentBytes, maxAttachments, onAttachmentError]);

  const convertFile = React.useCallback(async (file: File, signal: AbortSignal): Promise<Attachment> => {
    if (uploadAttachment) return normalizeAttachment(file, await uploadAttachment(file, { signal }));

    return {
      name: file.name,
      type: file.type,
      data: await readFileAsDataURL(file, signal),
      size: file.size,
    };
  }, [uploadAttachment]);

  const handleFiles = React.useCallback(async (incomingFiles: FileList | File[] | null, source: AttachmentSource) => {
    if (!canIngestFiles) return;

    const files = listFiles(incomingFiles);
    if (files.length === 0) return;

    const acceptedFiles: File[] = [];
    let nextCount = attachmentsRef.current.length;

    for (const file of files) {
      if (!matchesAccept(file, accept ?? '')) {
        reportAttachmentError(
          'unsupported-type',
          source,
          file,
          `${file.name} is not an accepted attachment type${accept ? ` (${accept})` : ''}.`,
        );
        continue;
      }

      if (maxAttachmentBytes !== undefined && file.size > maxAttachmentBytes) {
        reportAttachmentError(
          'too-large',
          source,
          file,
          `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(maxAttachmentBytes)}.`,
        );
        continue;
      }

      if (maxAttachments !== undefined && nextCount >= maxAttachments) {
        reportAttachmentError(
          'too-many',
          source,
          file,
          `Only ${maxAttachments} attachment${maxAttachments === 1 ? '' : 's'} allowed. Remove an attachment before adding ${file.name}.`,
        );
        continue;
      }

      nextCount += 1;
      acceptedFiles.push(file);
    }

    if (acceptedFiles.length === 0) return;

    const operation: PendingAttachmentWork['operation'] = uploadAttachment ? 'upload' : 'read';
    const pendingWork = acceptedFiles.map((file): PendingAttachmentWork => {
      const pendingId = createPendingAttachmentId();
      const controller = new AbortController();
      pendingControllersRef.current.set(pendingId, controller);
      return {
        file,
        pendingId,
        controller,
        operation,
        placeholder: createPendingAttachment(file, pendingId, operation),
      };
    });

    setAttachments(prev => [...prev, ...pendingWork.map(work => work.placeholder)]);

    await Promise.all(pendingWork.map(async ({ file, pendingId, controller }) => {
      try {
        const attachment = await convertFile(file, controller.signal);
        if (controller.signal.aborted) return;
        setAttachments(prev => {
          let replaced = false;
          const next = prev.map(att => {
            if (getPendingAttachmentId(att) !== pendingId) return att;
            replaced = true;
            return attachment;
          });
          return replaced ? next : prev;
        });
      } catch (error) {
        const wasCancelled = controller.signal.aborted || isAbortError(error);
        if (!wasCancelled) {
          const detail = error instanceof Error ? error.message : String(error);
          const reason = uploadAttachment ? 'upload-failed' : 'read-failed';
          const verb = uploadAttachment ? 'uploaded' : 'read';
          reportAttachmentError(reason, source, file, `${file.name} could not be ${verb}: ${detail}`);
        }
        setAttachments(prev => prev.filter(att => getPendingAttachmentId(att) !== pendingId));
      } finally {
        pendingControllersRef.current.delete(pendingId);
      }
    }));
  }, [accept, canIngestFiles, convertFile, maxAttachmentBytes, maxAttachments, reportAttachmentError, uploadAttachment]);

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canIngestFiles) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    void handleFiles(e.target.files, 'picker');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (!showAttachBtn) return;
    const files = filesFromTransfer(e.clipboardData);
    if (files.length === 0) return;
    if (!canIngestFiles) {
      e.preventDefault();
      return;
    }
    void handleFiles(files, 'paste');
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!showAttachBtn || !transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (!canIngestFiles) return;
    dragDepthRef.current += 1;
    setDraggingFiles(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!showAttachBtn || !transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (!canIngestFiles) return;
    e.dataTransfer.dropEffect = 'copy';
    setDraggingFiles(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!showAttachBtn || !transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (!canIngestFiles) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDraggingFiles(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!showAttachBtn || !transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDraggingFiles(false);
    if (!canIngestFiles) return;
    void handleFiles(filesFromTransfer(e.dataTransfer), 'drop');
  };

  const removeAttachment = (idx: number) => {
    if (composerInactive) return;
    const attachment = attachmentsRef.current[idx];
    const pendingId = attachment ? getPendingAttachmentId(attachment) : undefined;
    if (pendingId) abortPendingAttachment(pendingId);
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  const handleRootPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    onPasteProp?.(e);
    if (!e.defaultPrevented) handlePaste(e);
  };

  const handleRootDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    onDragEnterProp?.(e);
    if (!e.defaultPrevented) handleDragEnter(e);
  };

  const handleRootDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    onDragOverProp?.(e);
    if (!e.defaultPrevented) handleDragOver(e);
  };

  const handleRootDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    onDragLeaveProp?.(e);
    if (!e.defaultPrevented) handleDragLeave(e);
  };

  const handleRootDrop = (e: React.DragEvent<HTMLDivElement>) => {
    onDropProp?.(e);
    if (!e.defaultPrevented) handleDrop(e);
  };

  const rootClassName = [
    `chorus-input${draggingFiles ? ' chorus-input--dragging' : ''}`,
    disabled && 'chorus-input--disabled',
    readOnly && 'chorus-input--readonly',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div
      {...rest}
      ref={rootRef}
      className={rootClassName}
      style={style}
      onPaste={handleRootPaste}
      onDragEnter={handleRootDragEnter}
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
      aria-disabled={composerInactive ? true : rest['aria-disabled']}
      title={inactiveReason ?? rest.title}
    >
      {inactiveReason && <span id={reasonId} className="chorus-sr-only">{inactiveReason}</span>}
      {attachments.length > 0 && (
        <div className="chorus-attachments">
          {attachments.map((att, i) => {
            const previewSource = getAttachmentPreviewSource(att);
            const pending = isPendingAttachment(att);
            const pendingOperation = getPendingAttachmentOperation(att);
            const pendingLabel = pendingOperation === 'read' ? 'Reading' : 'Uploading';
            return (
              <div key={getPendingAttachmentId(att) ?? `${att.name}-${i}`} className={`chorus-attachment-chip${pending ? ' chorus-attachment-chip--pending' : ''}`}>
                {pending ? (
                  <span className="chorus-attachment-spinner" aria-hidden="true" />
                ) : att.type.startsWith('image/') && previewSource && (
                  <img src={previewSource} alt={att.name} className="chorus-attachment-thumb" loading="lazy" decoding="async" />
                )}
                <span className="chorus-attachment-name">{att.name}</span>
                {pending && <span className="chorus-sr-only">{pendingLabel} {att.name}</span>}
                <button type="button" className="chorus-attachment-remove" onClick={() => removeAttachment(i)} aria-label={`Remove ${att.name}`} disabled={composerInactive} aria-disabled={composerInactive || undefined}>
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className={`chorus-input-row${showAttachBtn ? ' chorus-input-row--has-attach' : ''}`}>
        {showAttachBtn && (
          <input ref={fileInputRef} type="file" accept={accept} multiple style={{ display: 'none' }} onChange={onFileInputChange} disabled={!canIngestFiles} />
        )}
        {showAttachBtn && (
          <button type="button" className="chorus-attach" onClick={() => { if (canIngestFiles) fileInputRef.current?.click(); }} aria-label="Attach file" title="Attach file" disabled={!canIngestFiles} aria-disabled={!canIngestFiles}>
            <Paperclip size={18} strokeWidth={2} />
          </button>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={onKeyDown}
          placeholder={placeholderText}
          aria-label={placeholder || 'Send a message'}
          aria-describedby={inactiveReason ? reasonId : undefined}
          disabled={disabled}
          readOnly={readOnly || disabled}
          aria-readonly={readOnly || disabled ? true : undefined}
        />
        <button type="button" className="chorus-send" onClick={handleClick} aria-label={sending ? 'Stop' : 'Send'} title={sending ? 'Stop' : 'Send'} disabled={sending ? !stopAvailable : !canSend}>
          {sending ? <span className="chorus-stop-fill" /> : <ArrowUp size={18} strokeWidth={2} />}
        </button>
      </div>
    </div>
  );
});
