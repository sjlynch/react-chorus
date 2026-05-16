import React from 'react';
import { Chorus } from '../Chorus';
import { ConversationList } from '../components/ConversationList';
import { useConversations } from '../hooks/useConversations';
import { MAX_IMAGE_BYTES, SUGGESTED_PROMPTS, WELCOME_MESSAGE } from './demoData';
import { mockTransport } from './mockTransport';

export function App() {
  const conversations = useConversations({ defaultTitle: 'New chat' });
  const [attachmentNotice, setAttachmentNotice] = React.useState<string | null>(null);
  const autoCreatedRef = React.useRef(false);

  React.useEffect(() => {
    if (autoCreatedRef.current) return;
    if (conversations.loaded && conversations.conversations.length === 0) {
      autoCreatedRef.current = true;
      conversations.createConversation('First chat');
    }
  }, [conversations]);

  const conversationStorage = conversations.storage ?? undefined;
  const activeKey = conversations.activePersistenceKey || '';

  return (
    <main className="pg-shell">
      <header className="pg-header">
        <span className="pg-brand">
          <span className="pg-logo">✦</span>
          react-chorus
        </span>
        <span className="pg-header-meta">
          <span className="pg-pill">
            <span className="pg-pill-dot" aria-hidden="true" />
            Mock SSE → real connector
          </span>
          <span className="pg-pill" title="Conversations and messages are saved to localStorage.">
            💾 Persists locally
          </span>
        </span>
      </header>

      <div className="pg-body">
        <aside className="pg-sidebar" aria-label="Conversations">
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
        </aside>

        <section className="pg-card" aria-label="react-chorus demo chat">
          <div className="pg-card-head">
            <span className="pg-card-head-title">
              {conversations.activeConversation?.title ?? 'Conversation'}
            </span>
            <span className={attachmentNotice ? 'pg-notice' : undefined}>
              {attachmentNotice ?? `Images ≤ ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB, up to 3`}
            </span>
          </div>

          {activeKey ? (
            <div className="pg-chorus-wrap">
              <Chorus
                key={conversations.activeId ?? 'none'}
                transport={mockTransport}
                persistenceKey={activeKey}
                persistenceStorage={conversationStorage}
                initialMessages={[WELCOME_MESSAGE]}
                suggestedPrompts={SUGGESTED_PROMPTS}
                placeholder="Ask react-chorus anything, or paste/drop an image…"
                accept="image/*"
                maxAttachmentBytes={MAX_IMAGE_BYTES}
                maxAttachments={3}
                onMessagesChange={(messages) => {
                  if (conversations.activeId) conversations.renameFromFirstMessage(conversations.activeId, messages);
                }}
                onAttachmentError={(error) => {
                  setAttachmentNotice(error.message);
                  window.setTimeout(() => setAttachmentNotice(null), 4000);
                }}
                palette={{
                  chatBg: 'transparent',
                  chatText: '#e7e7ea',
                  assistantBubbleBg: 'rgba(255,255,255,0.05)',
                  assistantBorder: 'rgba(255,255,255,0.08)',
                  assistantText: '#f4f4f5',
                  userBubbleBg: '#6366f1',
                  userBorder: '#4f46e5',
                  userText: '#ffffff',
                  inputBg: 'rgba(255,255,255,0.04)',
                  inputBorder: 'rgba(255,255,255,0.10)',
                  inputText: '#f4f4f5',
                  sendButtonBg: '#6366f1',
                  sendButtonText: '#ffffff',
                  focusRing: 'rgba(99,102,241,0.35)',
                  border: 'rgba(255,255,255,0.06)',
                }}
              />
            </div>
          ) : (
            <div className="pg-card-empty">
              Create a conversation in the sidebar to start chatting.
            </div>
          )}
        </section>
      </div>

      <p className="pg-footer">
        <a href="https://github.com/sjlynch/react-chorus" target="_blank" rel="noreferrer">View on GitHub</a>
        {' · '}
        <a href="https://www.npmjs.com/package/react-chorus" target="_blank" rel="noreferrer">npm</a>
        {' · '}
        Reasoning + tool calls in this demo are streamed via a mock OpenAI-format SSE transport through the real <code>autoConnector</code>.
      </p>
    </main>
  );
}
