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
