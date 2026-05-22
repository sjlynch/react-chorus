import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';

// Server-generated uuid per visit: each "Start a fresh conversation" click
// lands on a unique /c/<uuid> URL, so the `persistenceKey={`chorus:c:<uuid>`}`
// in the dynamic route below cannot collide with a previously stored draft.
// This mirrors the loader-redirect alternative documented in the `useId` /
// `useEffect` pattern section of docs/guide.md — the URL is the source of
// truth for the conversation id.
export const dynamic = 'force-dynamic';

export default function NewConversationPage() {
  redirect(`/c/${randomUUID()}`);
}
