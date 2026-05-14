import React from 'react';
import 'react-chorus/styles.css';
import { Chorus, ConversationList, useConversations } from 'react-chorus';
import type { ChorusOnSend } from 'react-chorus';

const handleSend: ChorusOnSend = async (text, _messages, { appendAssistant, finalizeAssistant, signal }) => {
  const reply = `This reply is stored in the active conversation. You said: "${text}"`;
  for (const word of reply.split(' ')) {
    if (signal.aborted) break;
    await new Promise(resolve => setTimeout(resolve, 50));
    appendAssistant(`${word} `);
  }
  finalizeAssistant();
};

export default function App() {
  const conversations = useConversations();
  const { loaded, createConversation } = conversations;
  const conversationCount = conversations.conversations.length;
  const seededRef = React.useRef(false);

  React.useEffect(() => {
    if (!seededRef.current && loaded && conversationCount === 0) {
      seededRef.current = true;
      createConversation('First chat');
    }
  }, [conversationCount, createConversation, loaded]);

  return (
    <div style={{ height: '100dvh', display: 'flex', gap: 12, padding: 12, boxSizing: 'border-box', background: '#0f0f0f' }}>
      <ConversationList {...conversations} style={{ width: 280, flex: '0 0 280px' }} />
      <main style={{ minWidth: 0, flex: 1 }}>
        <Chorus
          key={conversations.activeId ?? 'no-conversation'}
          persistenceKey={conversations.activePersistenceKey}
          persistenceStorage={conversations.storage ?? undefined}
          onSend={handleSend}
          placeholder="Type in the selected conversation…"
          showClearButton
        />
      </main>
    </div>
  );
}
