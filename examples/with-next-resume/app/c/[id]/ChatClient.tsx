'use client';

import { Chorus, type Message } from 'react-chorus';

interface ChatClientProps {
  conversationId: string;
  initial: Message[];
}

// Client component. `initialMessages` is captured once at mount (frozen-seed
// contract), so it must come in as a stable prop shaped on the server. The
// per-conversation `persistenceKey` keeps follow-up turns cached in the
// browser; a stored payload for the same key wins over `initialMessages` on
// subsequent visits — see the Server-side history pre-load recipe in
// docs/guide.md for the precedence rule and reconciliation strategies.
export function ChatClient({ conversationId, initial }: ChatClientProps) {
  return (
    <Chorus
      transport="/api/chat"
      connector="openai"
      initialMessages={initial}
      persistenceKey={`chorus:c:${conversationId}`}
      errorMessage="The OpenAI route could not complete that request. Please try again."
      onError={(error) => console.error(error)}
    />
  );
}
