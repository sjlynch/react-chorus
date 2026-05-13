import React from 'react';
import ReactDOM from 'react-dom/client';
import { Chorus } from './Chorus';
import type { Attachment, Message } from './types';

const DEMO_CHUNK_DELAY_MS = 45;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const initialMessages: Message[] = [
  {
    id: 'welcome',
    role: 'assistant',
    text: 'Welcome to the react-chorus playground. Try a streaming prompt, paste or drop an image, then use the message actions to edit, retry, regenerate, or delete turns.',
  },
];

const REPLIES = [
  'Here is a streamed response from the local playground transport.',
  'react-chorus keeps the drop-in defaults while exposing composable hooks and components.',
  'This demo is running without a backend; swap in transport="/api/chat" when you are ready for production streaming.',
  'Attachments are validated in the composer and travel with the current user turn.',
];

async function streamWords(reply: string, appendAssistant: (chunk: string) => void, signal: AbortSignal) {
  for (const word of reply.split(' ')) {
    if (signal.aborted) break;
    await new Promise((r) => setTimeout(r, DEMO_CHUNK_DELAY_MS));
    appendAssistant(`${word} `);
  }
}

async function handleSend(
  text: string,
  messages: Message[],
  {
    appendAssistant,
    finalizeAssistant,
    signal,
  }: {
    appendAssistant: (chunk: string) => void;
    finalizeAssistant: () => void;
    signal: AbortSignal;
  }
) {
  const currentTurn = messages[messages.length - 1];
  const attachments: Attachment[] = currentTurn?.attachments ?? [];
  const attachmentSummary = attachments.length
    ? ` I received ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}: ${attachments.map(att => att.name).join(', ')}.`
    : '';
  const base = REPLIES[Math.floor(Math.random() * REPLIES.length)];
  const promptSummary = text ? ` You said: “${text}”.` : ' You sent an attachment-only turn.';

  await streamWords(`${base}${promptSummary}${attachmentSummary}`, appendAssistant, signal);
  finalizeAssistant();
}

function FeaturePanel() {
  return (
    <aside className="playground-panel" aria-label="Playground features">
      <p className="playground-eyebrow">Built-in demo</p>
      <h1>react-chorus playground</h1>
      <p className="playground-copy">A branded first look at the batteries-included chat shell.</p>
      <ul>
        <li>Token-by-token streaming with stop/retry</li>
        <li>Paste, drop, or pick image attachments</li>
        <li>Edit/regenerate/delete message actions</li>
        <li>Themeable defaults via palette variables</li>
      </ul>
      <p className="playground-note">No backend required — this page simulates an assistant stream locally.</p>
    </aside>
  );
}

function App() {
  const [attachmentNotice, setAttachmentNotice] = React.useState<string | null>(null);

  return (
    <>
      <style>{`
        :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        * { box-sizing: border-box; }
        body { margin: 0; background: #0f0f10; color: #f4f4f5; }
        .playground-shell { min-height: 100dvh; display: grid; grid-template-columns: minmax(260px, 380px) minmax(0, 1fr); gap: 24px; padding: 24px; background: radial-gradient(circle at top left, rgba(237, 115, 46, 0.24), transparent 38%), #0f0f10; }
        .playground-panel { align-self: stretch; border: 1px solid rgba(255,255,255,0.10); border-radius: 24px; padding: 28px; background: rgba(22,22,22,0.82); box-shadow: 0 20px 60px rgba(0,0,0,0.35); }
        .playground-eyebrow { margin: 0 0 12px; color: #ed732e; font-size: 12px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; }
        .playground-panel h1 { margin: 0; font-size: clamp(32px, 5vw, 52px); line-height: 0.95; letter-spacing: -0.05em; }
        .playground-copy { color: #d4d4d8; line-height: 1.6; }
        .playground-panel ul { display: grid; gap: 10px; margin: 24px 0; padding: 0; list-style: none; }
        .playground-panel li { padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); }
        .playground-note { color: #a1a1aa; font-size: 13px; line-height: 1.5; }
        .playground-chat-card { min-height: 0; display: flex; flex-direction: column; border: 1px solid rgba(255,255,255,0.10); border-radius: 24px; padding: 16px; background: rgba(18,18,19,0.72); box-shadow: 0 20px 60px rgba(0,0,0,0.35); }
        .playground-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 4px 14px; color: #a1a1aa; font-size: 13px; }
        .playground-brand { display: inline-flex; align-items: center; gap: 10px; color: #fafafa; font-weight: 700; }
        .playground-logo { width: 28px; height: 28px; border-radius: 9px; display: inline-grid; place-items: center; background: #ed732e; color: #fff; }
        .playground-notice { color: #fbbf24; }
        @media (max-width: 860px) { .playground-shell { grid-template-columns: 1fr; padding: 14px; } .playground-panel { padding: 20px; } .playground-chat-card { height: 70dvh; } }
        @media (min-width: 861px) { .playground-chat-card { height: calc(100dvh - 48px); } }
      `}</style>
      <main className="playground-shell">
        <FeaturePanel />
        <section className="playground-chat-card" aria-label="react-chorus demo chat">
          <div className="playground-toolbar">
            <span className="playground-brand"><span className="playground-logo">✦</span> react-chorus</span>
            <span className="playground-notice">{attachmentNotice ?? `Images ≤ ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB, up to 3`}</span>
          </div>
          <Chorus
            onSend={handleSend}
            initialMessages={initialMessages}
            placeholder="Ask about react-chorus, or paste/drop an image…"
            accept="image/*"
            maxAttachmentBytes={MAX_IMAGE_BYTES}
            maxAttachments={3}
            onAttachmentError={(error) => {
              setAttachmentNotice(error.message);
              window.setTimeout(() => setAttachmentNotice(null), 4000);
            }}
            palette={{
              chatBg: '#161616',
              chatText: '#f4f4f5',
              assistantBubbleBg: '#ed732e',
              assistantBorder: '#c95e22',
              userBubbleBg: '#f4f4f5',
              userText: '#111111',
              inputBg: '#101011',
              inputBorder: '#3f3f46',
              sendButtonBg: '#ed732e',
              sendButtonText: '#ffffff',
              focusRing: 'rgba(237,115,46,0.28)',
            }}
          />
        </section>
      </main>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
