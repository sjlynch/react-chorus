import type { Attachment, Message } from './types';

export interface ChorusRef<TMeta = Record<string, unknown>> {
  /**
   * Programmatically submit a user message. Returns `true` when Chorus accepted
   * the send and started a turn, and `false` when it was rejected. A `false`
   * result means nothing was appended to the transcript and no transport/onSend
   * call was made — rejection cases are:
   * - `disabled` / `readOnly`, or an async built-in persistence load is pending (writes are gated);
   * - controlled mode (`value` provided) with no `onChange` prop, so the new message could not be reflected;
   * - a send/tool turn is already in flight;
   * - the text is empty and no attachments were supplied;
   * - neither `transport` nor `onSend` is configured.
   *
   * On an accepted send the composer is reset the same way a UI-driven send
   * resets it: the draft is cleared, the textarea collapses to a single line,
   * and any attachment chips the user had staged are discarded.
   */
  send(text: string, attachments?: Attachment[]): boolean;
  stop(): void;
  /**
   * Programmatically clear the transcript. Returns `true` when the clear path
   * was kicked off and `false` when it was rejected. Rejection cases are:
   * - `disabled` / `readOnly`, or an async built-in persistence load is pending;
   * - a previous `confirmClearConversation` promise is still pending;
   * - controlled mode (`value` provided) with no `onChange` prop, so the reset could not be reflected.
   *
   * Note: when `confirmClearConversation` is configured, `true` means the
   * confirmation flow was started — the actual reset still depends on the
   * callback resolving to anything other than `false`.
   */
  clear(): boolean;
  /**
   * Re-run the last assistant turn after a stream error — the imperative
   * equivalent of the built-in error banner's Retry control. Returns `true`
   * when a retry was started and `false` when it was rejected. Rejection cases
   * are:
   * - there is no current stream error to retry;
   * - `disabled` / `readOnly`, or an async built-in persistence load is pending;
   * - controlled mode (`value` provided) with no `onChange` prop.
   */
  retry(): boolean;
  /**
   * Regenerate a specific assistant message, replaying the conversation from
   * the user turn that preceded it. Returns `true` when regeneration was
   * started and `false` when it was rejected. Rejection cases are:
   * - `messageId` does not match a message, or no user message precedes it;
   * - `disabled` / `readOnly`, or an async built-in persistence load is pending;
   * - controlled mode (`value` provided) with no `onChange` prop.
   */
  regenerate(messageId: string): boolean;
  /**
   * Clear the current stream error state — the imperative equivalent of
   * dismissing the built-in error banner. Returns `true` when an error was
   * cleared and `false` when it was rejected. Rejection cases are:
   * - there is no current stream error to dismiss;
   * - controlled mode (`value` provided) with no `onChange` prop.
   *
   * Unlike the other mutators, this is **not** gated by `disabled` /
   * `readOnly` / a pending persistence load: dismissing an error mutates
   * only transient stream-error state, not the transcript, so it stays
   * available in those modes — matching the built-in banner's dismiss button.
   */
  dismissError(): boolean;
  focus(): void;
  getMessages(): Message<TMeta>[];
  /**
   * Scroll the transcript to a message's row. Returns `true` when a rendered
   * row for `id` was found and scrolled into view, and `false` otherwise.
   *
   * A `false` result covers two distinct cases:
   * - `id` matches no message in the transcript; or
   * - `id` is a valid message (one `getMessages()` returns) whose row is not
   *   currently in the DOM — windowed out by `maxRenderedMessages`, hidden by
   *   `hiddenRoles`, or drawn by a custom `renderMessage` that did not spread
   *   `ctx.messageProps`.
   *
   * To tell the two apart, cross-check `id` against `getMessages()`: a `false`
   * for an id `getMessages()` includes is the valid-but-unrendered case. In
   * development that case also logs a one-time warning. In particular a
   * "jump to message"/citation target older than the `maxRenderedMessages`
   * window cannot be scrolled to until enough older rows render.
   */
  scrollToMessage(id: string): boolean;
}
