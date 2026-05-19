import type { Attachment, Message } from '../types';
import type { ProviderMappingOptions } from './types/common';

// Local dev gate + warn-once cache. Duplicated from utils/warnings.ts so the
// provider-requests subpath stays standalone (server-friendly, no shared utils
// chunk). Same pattern as ChatWindow / useDeleteConversationConfirmation —
// see src/utils/CLAUDE.md.
const warnedKeys = new Set<string>();
function warnOnceInDev(key: string, message: string): void {
  if (typeof process === 'undefined' || typeof process.env === 'undefined') return;
  if (process.env.NODE_ENV === 'production') return;
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(message);
}

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

export function fileUriFromAttachment(attachment: Attachment) {
  for (const candidate of [attachment.url, attachment.id, attachment.data]) {
    if (typeof candidate === 'string' && candidate && !candidate.startsWith('data:')) return candidate;
  }
  return null;
}
