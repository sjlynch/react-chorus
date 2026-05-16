import React from 'react';
import { Chorus } from '../../Chorus';
import type { Message } from '../../types';
import { DEMO_PALETTE } from './palettes';
import { attachmentsTransport } from './attachmentsTransport';

const MAX_IMAGE_BYTES = 1 * 1024 * 1024;

const WELCOME_MESSAGE: Message = {
  id: 'welcome-attachments',
  role: 'assistant',
  text: "**Image attachments.** Use the **📎** button, paste with Ctrl/⌘+V, or drag a file onto the chat to attach an image. Chorus reads it as a base64 data URL by default (override with `uploadAttachment`), shows a preview chip, and emits an `onAttachmentError` event if it's the wrong type, too large, or you exceed the count.\n\nThis tab limits attachments to **≤ 1 MB, up to 3 images** so it's easy to hit the error path.",
};

const SUGGESTED_PROMPTS = [
  'What can you see?',
  'Describe this image',
  'Compare these images',
];

export function AttachmentsTab() {
  const [notice, setNotice] = React.useState<string | null>(null);

  return (
    <div className="pg-tab-stack">
      <div className="pg-tab-toolbar">
        <span className="pg-tab-toolbar-label">
          Limits: ≤ {Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB · up to 3 images · `image/*` only
        </span>
        {notice && <span className="pg-notice" role="status">{notice}</span>}
      </div>

      <Chorus
        transport={attachmentsTransport}
        persistenceKey="react-chorus-pg:attachments"
        initialMessages={[WELCOME_MESSAGE]}
        suggestedPrompts={SUGGESTED_PROMPTS}
        placeholder="Attach an image, then ask about it…"
        accept="image/*"
        maxAttachmentBytes={MAX_IMAGE_BYTES}
        maxAttachments={3}
        showClearButton
        palette={DEMO_PALETTE}
        onAttachmentError={(error) => {
          setNotice(error.message);
          window.setTimeout(() => setNotice(null), 4000);
        }}
      />
    </div>
  );
}
