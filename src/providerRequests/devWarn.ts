// Local dev gate + warn-once cache. Kept inside providerRequests (rather than
// imported from utils/warnings.ts) so the provider-requests subpath stays
// standalone — server-friendly, with no shared utils chunk. Same pattern as
// ChatWindow / useDeleteConversationConfirmation; see src/utils/CLAUDE.md.
const warnedKeys = new Set<string>();

export function warnOnceInDev(key: string, message: string): void {
  if (typeof process === 'undefined' || typeof process.env === 'undefined') return;
  if (process.env.NODE_ENV === 'production') return;
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(message);
}
