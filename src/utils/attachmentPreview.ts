import type { Attachment } from '../types';

/**
 * `data:` MIME types that are safe to surface in an attachment preview.
 *
 * SVG (`image/svg+xml`) and HTML (`text/html`, `application/xhtml+xml`) are
 * deliberately excluded: both can execute script when a consumer renders the
 * source through anything other than `<img>` (e.g. `<object>`/`<iframe>`), so
 * they are routed to "no preview" instead. `blob:`/`http(s):` sources carry no
 * inline MIME information and are not an inline-script vector, so they pass
 * through unchanged.
 */
const SAFE_DATA_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/avif',
]);

const SAFE_DATA_FILE_TYPES = new Set(['application/pdf']);

const SAFE_DATA_TYPE_PREFIXES = ['audio/', 'video/'];

function isSafeDataUrl(src: string): boolean {
  // A well-formed data: URL is `data:[<mediatype>][;base64],<data>`. Require a
  // non-empty media type terminated by ';' or ','; malformed URLs (no comma,
  // empty type) produce no match and fall through to "not renderable".
  const match = /^data:([^;,]+)[;,]/i.exec(src);
  if (!match) return false;
  const mime = (match[1] ?? '').trim().toLowerCase();
  if (SAFE_DATA_IMAGE_TYPES.has(mime) || SAFE_DATA_FILE_TYPES.has(mime)) return true;
  return SAFE_DATA_TYPE_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

export function isRenderableAttachmentSource(src: string | undefined): src is string {
  if (!src) return false;
  // blob:/http(s): URLs expose no inline MIME and are rendered via <img>; allow.
  if (/^(blob:|https?:)/i.test(src)) return true;
  // data: URLs embed their MIME type — only surface a curated, script-free set.
  if (/^data:/i.test(src)) return isSafeDataUrl(src);
  return false;
}

export function getAttachmentPreviewSource(att: Attachment): string | undefined {
  // Prefer url over data, but skip a defined-but-unrenderable url (file id,
  // gs:// URI, empty string) so a valid data: URL still previews.
  return [att.url, att.data].find(isRenderableAttachmentSource);
}
