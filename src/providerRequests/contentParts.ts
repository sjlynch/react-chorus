import type { Attachment, Message } from '../types';
import {
  resolveProviderAttachmentSource,
  unsupportedAttachmentPart,
  type ProviderAttachmentSource,
} from './attachments';
import { warnOnceInDev } from './devWarn';
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
  /** Provider label used in the dev warn-once key emitted when an attachment degrades to text. */
  provider: string;
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
  // Attachments are surfaced for every role that carries them, not just `user`.
  // `AssistantMessage` explicitly allows `attachments`, and a dropped attachment
  // on any role must be observable (as the unsupported-attachment text block,
  // with a dev warning) rather than silently discarded.
  const includeAttachments = spec.includeAttachments?.(message) ?? Boolean(message.attachments?.length);
  if (!includeAttachments) return parts;

  for (const attachment of message.attachments ?? []) {
    // Only `user`-turn attachments are mapped to provider media parts: no
    // provider accepts an image/file block in an assistant (or system) turn, so
    // non-user attachments always degrade to the unsupported-attachment block.
    const part = message.role === 'user' ? spec.mapAttachment?.(attachment, message) ?? null : null;
    if (part) {
      parts.push(part);
      continue;
    }
    const name = attachment.name || 'attachment';
    warnOnceInDev(
      `react-chorus:unsupported-attachment:${spec.provider}:${name}`,
      `[react-chorus] ${spec.provider} request: attachment "${name}" could not be represented in the ` +
        'provider schema and was replaced with an unsupported-attachment text block.',
    );
    parts.push(unsupportedAttachmentPart(attachment, message, options, spec.createTextPart));
  }

  return parts;
}
