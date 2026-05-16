import React from 'react';
import { Chorus } from '../../Chorus';
import { ConversationList } from '../../components/ConversationList';
import { useConversations } from '../../hooks/useConversations';
import { DEMO_PALETTE } from './palettes';
import { streamingBasicsTransport } from './streamingBasicsTransport';

export function MultiConversationTab() {
  const conversations = useConversations({
    defaultTitle: 'New chat',
    indexKey: 'react-chorus-pg:multi-conversation:index',
    messageKeyPrefix: 'react-chorus-pg:multi-conversation:msg:',
  });
  const autoCreatedRef = React.useRef(false);
  const [writeCount, setWriteCount] = React.useState(0);

  React.useEffect(() => {
    if (autoCreatedRef.current) return;
    if (conversations.loaded && conversations.conversations.length === 0) {
      autoCreatedRef.current = true;
      conversations.createConversation('First chat');
    }
  }, [conversations]);

  const activeKey = conversations.activePersistenceKey || '';
  const conversationStorage = conversations.storage ?? undefined;

  return (
    <div className="pg-multi-shell">
      <aside className="pg-multi-sidebar" aria-label="Conversations">
        <ConversationList
          conversations={conversations.conversations}
          activeId={conversations.activeId}
          createConversation={conversations.createConversation}
          selectConversation={conversations.selectConversation}
          renameConversation={conversations.renameConversation}
          deleteConversation={conversations.deleteConversation}
          pinConversation={conversations.pinConversation}
          newConversationLabel="+ New chat"
          emptyLabel="No conversations yet"
        />
        <div className="pg-multi-stats" aria-live="polite">
          <span>📚 {conversations.conversations.length} chat{conversations.conversations.length === 1 ? '' : 's'}</span>
          <span>💾 {writeCount} message-change event{writeCount === 1 ? '' : 's'}</span>
        </div>
      </aside>

      <div className="pg-multi-chat">
        {activeKey ? (
          <Chorus
            key={conversations.activeId ?? 'none'}
            transport={streamingBasicsTransport}
            persistenceKey={activeKey}
            persistenceStorage={conversationStorage}
            placeholder="Type in the selected conversation…"
            disabled={!conversations.loaded || !conversations.activeId}
            disabledReason={!conversations.loaded ? 'Loading conversations…' : !conversations.activeId ? 'Create or select a conversation first.' : undefined}
            showClearButton
            palette={DEMO_PALETTE}
            suggestedPrompts={['Tell me about react-chorus', "What's the weather in Tokyo?", 'Show me a code sample']}
            onMessagesChange={(messages, context) => {
              if (conversations.activeId) conversations.renameFromFirstMessage(conversations.activeId, messages);
              if (context.reason !== 'initial' && context.reason !== 'persistence-load' && context.reason !== 'persistence-seed') {
                setWriteCount(n => n + 1);
              }
            }}
          />
        ) : (
          <div className="pg-card-empty">
            Create a conversation in the sidebar to start chatting.
          </div>
        )}
      </div>
    </div>
  );
}
