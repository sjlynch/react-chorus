import Link from 'next/link';
import { loadConversation } from '../../../lib/conversations';
import { ChatClient } from './ChatClient';

// Server component. `loadConversation` is the seam where a real app would
// authorize the id against the current session and fetch from its database;
// the server-rendered HTML never leaks transcripts the user cannot see.
export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const initial = await loadConversation(id);

  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <header style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between' }}>
        <Link href="/">← All conversations</Link>
        <strong>{id}</strong>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ChatClient conversationId={id} initial={initial} />
      </div>
    </main>
  );
}
