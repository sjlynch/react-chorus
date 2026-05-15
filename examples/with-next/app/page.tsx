'use client';

import { Chorus } from 'react-chorus';

export default function Page() {
  return (
    <main style={{ height: '100dvh' }}>
      <Chorus
        transport="/api/chat"
        connector="openai"
        accept="image/*"
        maxAttachmentBytes={2 * 1024 * 1024}
        suggestedPrompts={[
          'Summarize a release note for customers',
          'Draft a support reply',
          'Explain this screenshot',
        ]}
        errorMessage="The OpenAI route could not complete that request. Please try again."
        onError={(error) => console.error(error)}
      />
    </main>
  );
}
