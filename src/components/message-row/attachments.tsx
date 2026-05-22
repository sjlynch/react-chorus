import type { Attachment } from '../../types';
import { DEFAULT_ATTACHMENT_LABELS } from '../../labels/attachments';
import type { ChorusAttachmentLabels } from '../../labels/types';
import { getAttachmentPreviewSource } from '../../utils/attachmentPreview';

export function resolveAttachmentImageAlt(att: Attachment, labels: ChorusAttachmentLabels = DEFAULT_ATTACHMENT_LABELS): string {
  if (typeof att.alt === 'string' && att.alt.length > 0) return att.alt;
  return labels.imageFallbackAlt(att.name);
}

export function MessageAttachments({ attachments, attachmentLabels = DEFAULT_ATTACHMENT_LABELS }: { attachments?: Attachment[]; attachmentLabels?: ChorusAttachmentLabels }) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="chorus-msg-attachments">
      {attachments.map((att, i) => {
        const previewSource = getAttachmentPreviewSource(att);
        return att.type.startsWith('image/') && previewSource
          ? <img key={i} src={previewSource} alt={resolveAttachmentImageAlt(att, attachmentLabels)} className="chorus-msg-img" loading="lazy" decoding="async" />
          : <span key={i} className="chorus-msg-file">{att.name}</span>;
      })}
    </div>
  );
}
