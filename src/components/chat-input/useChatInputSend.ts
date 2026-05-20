import type { RefObject } from 'react';
import type { Attachment } from '../../types';
import { isPendingAttachment } from './attachmentUtils';

// Inlined — importing `utils/async` puts ChatInput on a shared chunk with the
// assistant-session hook tree and inflates the ChatInput bundle-size number
// tracked in the README "Current numbers" table.
function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof (value as { then?: unknown }).then === 'function';
}

interface UseChatInputSendOptions {
  attachments: Attachment[];
  canSend: boolean;
  onSend: (attachments: Attachment[]) => void | boolean | Promise<void | boolean>;
  onAcceptedSend: () => void;
  /**
   * Monotonic counter bumped on every composer edit. Captured at send time so a
   * slow async `onSend` that resolves after the user has stopped and started
   * typing again does not wipe the freshly-typed input.
   */
  composerGenerationRef: RefObject<number>;
}

export function useChatInputSend({
  attachments,
  canSend,
  onSend,
  onAcceptedSend,
  composerGenerationRef,
}: UseChatInputSendOptions) {
  const handleSend = () => {
    if (!canSend) return;

    const result = onSend(attachments.filter(att => !isPendingAttachment(att)));
    if (result === false) return;

    if (isPromiseLike<void | boolean>(result)) {
      const generationAtSend = composerGenerationRef.current;
      void Promise.resolve(result).then(accepted => {
        if (accepted === false) return;
        // The user has edited the composer since this send was dispatched
        // (e.g. stopped the request and started a new message) — leave their
        // current input alone instead of clearing it.
        if (composerGenerationRef.current !== generationAtSend) return;
        onAcceptedSend();
      }, () => undefined);
      return;
    }

    onAcceptedSend();
  };

  return { handleSend };
}
