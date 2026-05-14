import React from 'react';
import ReactDOM from 'react-dom/client';
import { Chorus } from './Chorus';
import type { Attachment, Message } from './types';

const DEMO_CHUNK_DELAY_MS = 28;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const initialMessages: Message[] = [
  {
    id: 'welcome',
    role: 'assistant',
    text: "**Welcome to react-chorus.** This playground simulates a streaming assistant locally — no backend needed.\n\nTry asking anything, paste an image, or use the message actions on hover.",
  },
];

const SUGGESTED_PROMPTS = [
  'Show me a code sample',
  'Summarize the key features',
  'Give me a markdown demo',
];

const REPLIES: Record<string, string> = {
  code: "Here's a tiny streaming setup:\n\n```tsx\nimport { Chorus } from 'react-chorus';\nimport 'react-chorus/styles.css';\n\nexport default function App() {\n  return <Chorus transport=\"/api/chat\" />;\n}\n```\n\nDrop in `transport`, ship a chat UI.",
  summary: "react-chorus gives you:\n\n- **Streaming UI** with token-by-token rendering and stop/retry\n- **Composable hooks** for transport, persistence, and message state\n- **Attachments** via paste, drop, or file picker\n- **Themeable defaults** through palette variables\n- **Markdown + code highlighting** out of the box",
  markdown: "Here's a quick markdown tour:\n\n### Lists work\n\n1. Numbered items\n2. *Italic* and **bold** text\n3. `inline code`\n\n> Block quotes render cleanly too.\n\n```js\nconst chunks = await response.body.getReader().read();\n```\n\nThat's the gist.",
  default: "react-chorus keeps the drop-in defaults while exposing composable hooks and components. Swap in `transport=\"/api/chat\"` when you're ready for real streaming.",
};

function pickReply(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (lower.includes('code') || lower.includes('sample')) return REPLIES.code;
  if (lower.includes('summar') || lower.includes('feature')) return REPLIES.summary;
  if (lower.includes('markdown')) return REPLIES.markdown;
  return REPLIES.default;
}

async function streamWords(reply: string, appendAssistant: (chunk: string) => void, signal: AbortSignal) {
  const tokens = reply.match(/\S+\s*|\s+/g) ?? [reply];
  for (const token of tokens) {
    if (signal.aborted) break;
    await new Promise((r) => setTimeout(r, DEMO_CHUNK_DELAY_MS));
    appendAssistant(token);
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
  const reply = pickReply(text);
  const attachmentNote = attachments.length
    ? `\n\n_Received ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}: ${attachments.map(a => a.name).join(', ')}._`
    : '';

  await streamWords(`${reply}${attachmentNote}`, appendAssistant, signal);
  finalizeAssistant();
}

function App() {
  const [attachmentNotice, setAttachmentNotice] = React.useState<string | null>(null);

  return (
    <>
      <style>{`
        :root {
          color-scheme: dark;
          font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          background:
            radial-gradient(1100px 600px at 85% -10%, rgba(237,115,46,0.10), transparent 60%),
            radial-gradient(900px 500px at -10% 110%, rgba(99,102,241,0.08), transparent 60%),
            #0b0b0d;
          color: #e7e7ea;
          min-height: 100dvh;
        }
        .pg-shell {
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 28px 20px;
          gap: 20px;
        }
        .pg-header {
          width: 100%;
          max-width: 820px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .pg-brand {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          font-weight: 600;
          font-size: 15px;
          color: #fafafa;
        }
        .pg-logo {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          display: inline-grid;
          place-items: center;
          background: linear-gradient(135deg, #ed732e, #c95e22);
          color: #fff;
          font-size: 14px;
          box-shadow: 0 6px 16px rgba(237,115,46,0.35);
        }
        .pg-tag {
          font-size: 12px;
          color: #a1a1aa;
          padding: 4px 10px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 9999px;
          background: rgba(255,255,255,0.02);
        }
        .pg-card {
          width: 100%;
          max-width: 820px;
          flex: 1 1 auto;
          min-height: 0;
          display: flex;
          flex-direction: column;
          background: rgba(20,20,22,0.78);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 18px;
          box-shadow: 0 30px 80px rgba(0,0,0,0.45);
          padding: 14px;
          backdrop-filter: blur(6px);
        }
        .pg-card-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 6px 10px;
          font-size: 12px;
          color: #a1a1aa;
        }
        .pg-status {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .pg-status-dot {
          width: 7px;
          height: 7px;
          border-radius: 9999px;
          background: #22c55e;
          box-shadow: 0 0 8px rgba(34,197,94,0.6);
        }
        .pg-notice {
          color: #fbbf24;
        }
        .pg-chorus-wrap {
          flex: 1 1 auto;
          min-height: 0;
          display: flex;
        }
        .pg-chorus-wrap > .chorus {
          flex: 1 1 auto;
          min-height: 0;
        }
        .pg-card .chorus-window {
          border: 0;
          padding: 4px 4px 0;
        }
        .pg-card .chorus-input {
          margin-top: 8px;
        }
        .pg-card .chorus-input-row textarea {
          border-radius: 14px;
          min-height: 48px;
        }
        .pg-footer {
          font-size: 12px;
          color: #71717a;
          text-align: center;
        }
        .pg-footer a {
          color: #a1a1aa;
          text-decoration: none;
          border-bottom: 1px dashed rgba(255,255,255,0.18);
        }
        .pg-footer a:hover { color: #fafafa; }
        @media (max-width: 640px) {
          .pg-shell { padding: 16px 12px; }
          .pg-card { padding: 10px; border-radius: 14px; }
        }
      `}</style>
      <main className="pg-shell">
        <header className="pg-header">
          <span className="pg-brand">
            <span className="pg-logo">✦</span>
            react-chorus
          </span>
          <span className="pg-tag">Live playground</span>
        </header>
        <section className="pg-card" aria-label="react-chorus demo chat">
          <div className="pg-card-head">
            <span className="pg-status">
              <span className="pg-status-dot" aria-hidden="true" />
              Streaming locally
            </span>
            <span className={attachmentNotice ? 'pg-notice' : undefined}>
              {attachmentNotice ?? `Images ≤ ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB, up to 3`}
            </span>
          </div>
          <div className="pg-chorus-wrap">
            <Chorus
              onSend={handleSend}
              initialMessages={initialMessages}
              suggestedPrompts={SUGGESTED_PROMPTS}
              placeholder="Ask react-chorus anything, or paste/drop an image…"
              accept="image/*"
              maxAttachmentBytes={MAX_IMAGE_BYTES}
              maxAttachments={3}
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
                userBubbleBg: '#ed732e',
                userBorder: '#c95e22',
                userText: '#ffffff',
                inputBg: 'rgba(255,255,255,0.04)',
                inputBorder: 'rgba(255,255,255,0.10)',
                inputText: '#f4f4f5',
                sendButtonBg: '#ed732e',
                sendButtonText: '#ffffff',
                focusRing: 'rgba(237,115,46,0.30)',
                border: 'rgba(255,255,255,0.06)',
              }}
            />
          </div>
        </section>
        <p className="pg-footer">
          <a href="https://github.com/sjlynch/react-chorus" target="_blank" rel="noreferrer">View on GitHub</a>
          {' · '}
          <a href="https://www.npmjs.com/package/react-chorus" target="_blank" rel="noreferrer">npm</a>
        </p>
      </main>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
