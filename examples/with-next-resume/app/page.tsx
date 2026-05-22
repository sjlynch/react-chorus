import Link from 'next/link';
import { knownConversationIds } from '../lib/conversations';

export default function HomePage() {
  return (
    <main style={{ padding: '2rem', maxWidth: '32rem', margin: '0 auto' }}>
      <h1>Server-side history pre-load</h1>
      <p>
        Pick a saved conversation below to see the Next.js server component fetch its transcript
        via <code>loadConversation(id)</code>, pass the result into <code>initialMessages</code>,
        and hand off to <code>persistenceKey</code> for follow-up turns. Or start a fresh chat —
        the <code>/c/new</code> route redirects to a server-generated id so each new conversation
        gets its own storage key.
      </p>
      <ul>
        {knownConversationIds.map((id) => (
          <li key={id}>
            <Link href={`/c/${id}`}>{id}</Link>
          </li>
        ))}
        <li>
          <Link href="/c/new">+ Start a fresh conversation</Link>
        </li>
      </ul>
    </main>
  );
}
