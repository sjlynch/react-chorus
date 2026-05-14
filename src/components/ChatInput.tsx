import React from 'react';
import { ArrowUp, Paperclip, X } from 'lucide-react';
import type {
  Attachment,
  AttachmentError,
  AttachmentErrorReason,
  AttachmentSource,
  AttachmentUploadResult,
  UploadAttachment,
} from '../types';

const MAX_HEIGHT = 160;

export interface ChatInputProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value: string;
  onChange: (v: string) => void;
  onSend: (attachments: Attachment[]) => void;
  onStop?: () => void;
  placeholder?: string;
  sending?: boolean;
  accept?: string;
  maxAttachmentBytes?: number;
  maxAttachments?: number;
  onAttachmentError?: (error: AttachmentError) => void;
  uploadAttachment?: UploadAttachment;
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

function readFileAsDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error(`Unable to read ${file.name} as a data URL.`));
    };
    reader.onerror = () => reject(reader.error ?? new Error(`Unable to read ${file.name}.`));
    reader.readAsDataURL(file);
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

function isRenderableAttachmentSource(src: string | undefined) {
  return !!src && /^(data:|blob:|https?:)/i.test(src);
}

function getAttachmentPreviewSource(att: Attachment) {
  const source = att.url ?? att.data;
  return isRenderableAttachmentSource(source) ? source : undefined;
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

  React.useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

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

  const canSend = value.trim().length > 0 || attachments.length > 0;
  const showAttachBtn = accept !== undefined;

  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + 'px';
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    resizeTextarea();
  };

  const handleSend = () => {
    onSend(attachments);
    attachmentsRef.current = [];
    setAttachments([]);
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
    if (sending) { onStop?.(); }
    else if (canSend) { handleSend(); }
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

  const convertFile = React.useCallback(async (file: File): Promise<Attachment> => {
    if (uploadAttachment) return normalizeAttachment(file, await uploadAttachment(file));

    return {
      name: file.name,
      type: file.type,
      data: await readFileAsDataURL(file),
      size: file.size,
    };
  }, [uploadAttachment]);

  const handleFiles = React.useCallback(async (incomingFiles: FileList | File[] | null, source: AttachmentSource) => {
    if (!showAttachBtn) return;

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

    const converted = await Promise.all(acceptedFiles.map(async file => {
      try {
        return await convertFile(file);
      } catch (error) {
        const reason: AttachmentErrorReason = uploadAttachment ? 'upload-failed' : 'read-failed';
        const detail = error instanceof Error ? error.message : String(error);
        reportAttachmentError(reason, source, file, `${file.name} could not be ${uploadAttachment ? 'uploaded' : 'read'}: ${detail}`);
        return null;
      }
    }));

    const nextAttachments = converted.filter((att): att is Attachment => att !== null);
    if (nextAttachments.length > 0) {
      setAttachments(prev => {
        const next = [...prev, ...nextAttachments];
        attachmentsRef.current = next;
        return next;
      });
    }
  }, [accept, convertFile, maxAttachmentBytes, maxAttachments, reportAttachmentError, showAttachBtn, uploadAttachment]);

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void handleFiles(e.target.files, 'picker');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (!showAttachBtn) return;
    const files = filesFromTransfer(e.clipboardData);
    if (files.length > 0) void handleFiles(files, 'paste');
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!showAttachBtn || !transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDraggingFiles(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!showAttachBtn || !transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDraggingFiles(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!showAttachBtn || !transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDraggingFiles(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!showAttachBtn || !transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDraggingFiles(false);
    void handleFiles(filesFromTransfer(e.dataTransfer), 'drop');
  };

  const removeAttachment = (idx: number) => setAttachments(prev => {
    const next = prev.filter((_, i) => i !== idx);
    attachmentsRef.current = next;
    return next;
  });

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

  return (
    <div
      {...rest}
      ref={rootRef}
      className={[`chorus-input${draggingFiles ? ' chorus-input--dragging' : ''}`, className].filter(Boolean).join(' ')}
      style={style}
      onPaste={handleRootPaste}
      onDragEnter={handleRootDragEnter}
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
    >
      {attachments.length > 0 && (
        <div className="chorus-attachments">
          {attachments.map((att, i) => {
            const previewSource = getAttachmentPreviewSource(att);
            return (
              <div key={`${att.name}-${i}`} className="chorus-attachment-chip">
                {att.type.startsWith('image/') && previewSource && (
                  <img src={previewSource} alt={att.name} className="chorus-attachment-thumb" />
                )}
                <span className="chorus-attachment-name">{att.name}</span>
                <button type="button" className="chorus-attachment-remove" onClick={() => removeAttachment(i)} aria-label={`Remove ${att.name}`}>
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className={`chorus-input-row${showAttachBtn ? ' chorus-input-row--has-attach' : ''}`}>
        {showAttachBtn && (
          <input ref={fileInputRef} type="file" accept={accept} multiple style={{ display: 'none' }} onChange={onFileInputChange} />
        )}
        {showAttachBtn && (
          <button type="button" className="chorus-attach" onClick={() => fileInputRef.current?.click()} aria-label="Attach file" title="Attach file">
            <Paperclip size={18} strokeWidth={2} />
          </button>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={onKeyDown}
          placeholder={placeholder || 'Send a message'}
          aria-label={placeholder || 'Send a message'}
        />
        <button type="button" className="chorus-send" onClick={handleClick} aria-label={sending ? 'Stop' : 'Send'} title={sending ? 'Stop' : 'Send'} disabled={!sending && !canSend}>
          {sending ? <span className="chorus-stop-fill" /> : <ArrowUp size={18} strokeWidth={2} />}
        </button>
      </div>
    </div>
  );
});
