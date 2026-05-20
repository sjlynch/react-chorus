import type { Attachment } from '../../types';

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
  /** Already filtered to sendable (resolved) attachments by `useAttachmentQueue`. */
  attachments: Attachment[];
  canSend: boolean;
  onSend: (attachments: Attachment[]) => void | boolean | Promise<void | boolean>;
  onAcceptedSend: () => void;
}

export function useChatInputSend({
  attachments,
  canSend,
  onSend,
  onAcceptedSend,
}: UseChatInputSendOptions) {
  const handleSend = () => {
    if (!canSend) return;

    const result = onSend(attachments);
    if (result === false) return;

    if (isPromiseLike<void | boolean>(result)) {
      void Promise.resolve(result).then(accepted => {
        if (accepted !== false) onAcceptedSend();
      }, () => undefined);
      return;
    }

    onAcceptedSend();
  };

  return { handleSend };
}
