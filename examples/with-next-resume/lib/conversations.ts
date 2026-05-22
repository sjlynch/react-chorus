import type { Message } from 'react-chorus';

// Stand-in for the database / KV / object store you would query in a real app.
// `loadConversation(id)` is called from a Next.js server component during the
// request, so the transcript is bound to the authenticated user before it is
// passed into the client as `initialMessages`. Never trust an id you cannot
// authorize against the current session.
const fixtures: Record<string, Message[]> = {
  'launch-q3': [
    { id: 'sys-launch', role: 'system', text: 'You are summarizing the Q3 launch retro for an executive update.' },
    { id: 'u-launch-1', role: 'user', text: 'What were the three biggest wins from the Q3 launch?' },
    {
      id: 'a-launch-1',
      role: 'assistant',
      text: '1. Dark-mode rollout shipped on schedule with zero P0 follow-ups.\n2. The new onboarding cut median time-to-first-message by 38%.\n3. The migration drained from the legacy queue two weeks ahead of plan.',
    },
    { id: 'u-launch-2', role: 'user', text: 'Anything we should flag as a risk for Q4?' },
  ],
  'support-acme': [
    { id: 'sys-support', role: 'system', text: 'You are a customer support assistant for ACME. Stay concise and link to docs when possible.' },
    { id: 'u-support-1', role: 'user', text: 'How do I cancel my subscription before the renewal date?' },
    {
      id: 'a-support-1',
      role: 'assistant',
      text: 'Open **Settings → Billing → Manage plan**, then choose **Cancel renewal**. Your access continues until the end of the current billing period.',
    },
  ],
};

export const knownConversationIds = Object.keys(fixtures);

export async function loadConversation(id: string): Promise<Message[]> {
  // Simulated database latency so the example's loading-state behavior matches
  // what a real server fetch would produce. Remove this in your own code.
  await new Promise((resolve) => setTimeout(resolve, 25));
  return fixtures[id] ?? [];
}
