import type { Attachment, Message } from '../types';
import { warnOnceInDev } from './devWarn';
import type { ProviderMappingOptions } from './types/common';

function defaultUnsupportedAttachmentText(attachment: Attachment): string {
  const name = attachment.name || 'attachment';
  const type = attachment.type ? ` (${attachment.type})` : '';
  return `[Unsupported attachment omitted: ${name}${type}]`;
}

export function unsupportedAttachmentText<TMeta>(
  attachment: Attachment,
  message: Message<TMeta>,
  options: ProviderMappingOptions<TMeta>,
) {
  return options.unsupportedAttachmentText?.(attachment, message) ?? defaultUnsupportedAttachmentText(attachment);
}

function parseDataUrl(value: string): { mimeType: string; base64: string } | null {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/i.exec(value);
  if (!match || !match[2]) return null;
  return { mimeType: match[1] || 'application/octet-stream', base64: match[2] };
}

function isOpenAIImageUrl(value: string) {
  if (/^https?:\/\//i.test(value)) return true;
  if (value.startsWith('data:')) return parseDataUrl(value) !== null;
  // Relative URLs (no URI scheme) are forwarded verbatim: OpenAI accepts any
  // URL string in `image_url`/`input_image` and resolves it from the proxy
  // host that holds the API key. Other schemes (gs:, file:, blob:, …) can't
  // be fetched by OpenAI, so we still reject them.
  return !/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(value);
}

/**
 * Resolve an OpenAI `image_url` / `input_image` URL from an attachment.
 *
 * Accepted URL shapes (checked against `attachment.url` then `attachment.data`):
 * - Absolute `http(s)://…` URLs.
 * - Well-formed base64 `data:` URLs (`data:<mime>;base64,<payload>` with a non-empty payload).
 * - Relative URLs without a scheme (`/uploads/abc.png`, `./a.png`, `images/x.png`)
 *   — forwarded verbatim; the proxy host resolves them.
 *
 * Other URI schemes (`gs:`, `file:`, `blob:`, …) and malformed `data:` URLs are
 * rejected because OpenAI cannot fetch them. When an image attachment is
 * dropped, a dev-mode warning is logged so the silent failure is observable.
 */
export function openAIImageUrlFromAttachment(attachment: Attachment) {
  const candidates = [attachment.url, attachment.data];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate && isOpenAIImageUrl(candidate)) return candidate;
  }
  const rejected = candidates.find((c): c is string => typeof c === 'string' && c.length > 0);
  const name = attachment.name || 'attachment';
  warnOnceInDev(
    `react-chorus:openai-image-url:${name}:${rejected ?? ''}`,
    `[react-chorus] OpenAI image attachment "${name}" was dropped — URL ${
      rejected ? `"${rejected}"` : '<missing>'
    } is not an http(s): URL, a base64 data: URL, or a relative path.`,
  );
  return null;
}

export function dataUrlFromAttachment(attachment: Attachment) {
  const data = typeof attachment.data === 'string' ? attachment.data : '';
  return data ? parseDataUrl(data) : null;
}

/**
 * Resolve the effective MIME type for a base64 `data:` URL attachment.
 *
 * Prefers the MIME type parsed from the `data:` URL header over
 * `attachment.type`: a UI may relabel an attachment so the two disagree, and
 * the bytes the provider actually receives are the ones the header describes.
 * Falls back to `attachment.type` only when the data-URL header is absent
 * (`parseDataUrl` reports the generic `application/octet-stream` placeholder).
 */
export function resolveDataUrlMimeType(attachment: Attachment, dataUrl: { mimeType: string }): string {
  const header = dataUrl.mimeType;
  if (header && header !== 'application/octet-stream') return header;
  return attachment.type || header;
}

export function fileUriFromAttachment(attachment: Attachment) {
  for (const candidate of [attachment.url, attachment.id, attachment.data]) {
    if (typeof candidate === 'string' && candidate && !candidate.startsWith('data:')) return candidate;
  }
  return null;
}
