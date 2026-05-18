import React from 'react';

export interface MessageRenderStateValue {
  messageId: string;
  isEditing: boolean;
  setIsEditing: (editing: boolean) => void;
}

export const MessageRenderStateContext = React.createContext<MessageRenderStateValue | null>(null);

export function MessageRenderStateProvider({ messageId, children }: { messageId: string; children: React.ReactNode }) {
  const [isEditing, setIsEditing] = React.useState(false);
  const value = React.useMemo(() => ({ messageId, isEditing, setIsEditing }), [messageId, isEditing]);

  return <MessageRenderStateContext.Provider value={value}>{children}</MessageRenderStateContext.Provider>;
}

export function useActionEditing(messageId: string) {
  const renderState = React.useContext(MessageRenderStateContext);
  const [localEditing, setLocalEditing] = React.useState(false);

  if (renderState?.messageId === messageId) {
    return [renderState.isEditing, renderState.setIsEditing] as const;
  }

  return [localEditing, setLocalEditing] as const;
}

// Focus the returned ref when `isEditing` transitions from true → false, so cancelling the
// inline editor returns focus to the originating Edit button instead of leaving it on <body>.
export function useReturnFocusAfterEditing<T extends HTMLElement>(isEditing: boolean) {
  const ref = React.useRef<T>(null);
  const wasEditingRef = React.useRef(false);
  React.useEffect(() => {
    if (wasEditingRef.current && !isEditing) ref.current?.focus();
    wasEditingRef.current = isEditing;
  }, [isEditing]);
  return ref;
}
