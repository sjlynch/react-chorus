import type { Attachment, Message } from '../types';
import {
  resolveProviderAttachmentSource,
  unsupportedAttachmentPart,
  type ProviderAttachmentSource,
} from './attachments';
import { messageText } from './toolOutput';
import type { ProviderMappingOptions } from './types/common';

type DataUrlAttachmentSource = Extract<ProviderAttachmentSource, { kind: 'data-url' }>;
type FileUriAttachmentSource = Extract<ProviderAttachmentSource, { kind: 'file-uri' }>;

export interface AttachmentSourcePartSpec<TPart> {
  dataUrlMimeTypes: ReadonlySet<string>;
  allowFileUri?: boolean;
  dataUrl: (source: DataUrlAttachmentSource, attachment: Attachment) => TPart | null;
  fileUri?: (source: FileUriAttachmentSource, attachment: Attachment) => TPart | null;
}

export function attachmentPartFromSource<TPart>(
  attachment: Attachment,
  spec: AttachmentSourcePartSpec<TPart>,
): TPart | null {
  const source = resolveProviderAttachmentSource(
    attachment,
    spec.dataUrlMimeTypes,
    spec.allowFileUri ? { allowFileUri: true } : {},
  );

  if (source.kind === 'data-url') return spec.dataUrl(source, attachment);
  if (source.kind === 'file-uri') return spec.fileUri?.(source, attachment) ?? null;
  return null;
}

export interface MessageContentPartsSpec<TMeta, TPart> {
  createTextPart: (text: string) => TPart;
  mapAttachment?: (attachment: Attachment, message: Message<TMeta>) => TPart | null;
  includeAttachments?: (message: Message<TMeta>) => boolean;
}

export function messageTextParts<TMeta, TPart>(
  message: Message<TMeta>,
  createTextPart: (text: string) => TPart,
): TPart[] {
  const parts: TPart[] = [];
  const text = messageText(message);
  if (text.trim()) parts.push(createTextPart(text));
  return parts;
}

export function messageContentParts<TMeta, TPart>(
  message: Message<TMeta>,
  options: ProviderMappingOptions<TMeta>,
  spec: MessageContentPartsSpec<TMeta, TPart>,
): TPart[] {
  const parts = messageTextParts(message, spec.createTextPart);
  const includeAttachments = spec.includeAttachments?.(message) ?? (message.role === 'user');
  if (!includeAttachments) return parts;

  for (const attachment of message.attachments ?? []) {
    const part = spec.mapAttachment?.(attachment, message) ?? null;
    parts.push(part ?? unsupportedAttachmentPart(attachment, message, options, spec.createTextPart));
  }

  return parts;
}
