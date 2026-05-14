import type { Attachment } from '../types';

export function isRenderableAttachmentSource(src: string | undefined) {
  return !!src && /^(data:|blob:|https?:)/i.test(src);
}

export function getAttachmentPreviewSource(att: Attachment) {
  const source = att.url ?? att.data;
  return isRenderableAttachmentSource(source) ? source : undefined;
}
