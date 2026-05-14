import React from 'react';
import ReactDOM from 'react-dom/client';
import { Chorus } from './Chorus';
import { ConversationList } from './components/ConversationList';
import { useConversations } from './hooks/useConversations';
import type { Message } from './types';
import type { Transport } from './hooks/useChorusStream';

const DEMO_CHUNK_DELAY_MS = 22;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  text: "**Welcome to react-chorus.** This playground streams a fake OpenAI-style SSE response through Chorus's real connector + stream pipeline — exactly the code path you'd ship with a real backend.\n\nTry a prompt below, then check the sidebar for a multi-conversation example. Messages persist locally — refresh the page and they're still here.",
};

const SUGGESTED_PROMPTS = [
  "What's the weather in Tokyo?",
  'Show me a code sample',
  'Give me a markdown demo',
];

const REPLY_TEXTS = {
  code: "Here's the smallest possible integration:\n\n```tsx\nimport { Chorus } from 'react-chorus';\nimport 'react-chorus/styles.css';\n\nexport default function App() {\n  return <Chorus transport=\"/api/chat\" />;\n}\n```\n\nPoint `transport` at any SSE endpoint (OpenAI, Anthropic, Gemini, or your own) and the connector auto-detects the format.",
  summary: "react-chorus gives you:\n\n- **Streaming UI** with token-by-token rendering, stop, and retry\n- **Reasoning traces** and **tool calls** rendered automatically when the connector detects them\n- **Multi-conversation** state via `useConversations` + `ConversationList`\n- **Persistence** through any `StorageAdapter` (localStorage by default)\n- **Attachments** via paste, drop, or file picker\n- **Themeable** through ~20 CSS palette variables",
  markdown: "Here's a quick markdown tour:\n\n### Lists work\n\n1. Numbered items\n2. *Italic* and **bold** text\n3. `inline code`\n\n> Block quotes render cleanly too.\n\n```js\nconst reader = response.body.getReader();\nconst { value, done } = await reader.read();\n```\n\nAnd inline links: [docs](https://github.com/sjlynch/react-chorus).",
  weather: "It's currently **22 °C and partly cloudy** in Tokyo, with 58% humidity and light winds out of the east. Comfortable jacket weather — no rain expected for the next few hours.",
  default: "react-chorus keeps the drop-in defaults while exposing composable hooks and components. The reply you just saw streamed through a mock `Transport` — swap that for your real SSE endpoint and the same UI keeps working.",
};

interface StreamPlan {
  reasoning?: string;
  toolCall?: {
    id: string;
    name: string;
    input: Record<string, unknown>;
    output: unknown;
  };
  text: string;
}

function planFor(prompt: string): StreamPlan {
  const p = prompt.toLowerCase();

  if (p.includes('weather')) {
    const location = /weather\s+(?:in|at|for)\s+([a-zA-Z\s]+)/i.exec(prompt)?.[1]?.trim() || 'Tokyo';
    return {
      reasoning: `The user is asking about current weather conditions for ${location}. I'll call the weather tool with the location and metric units, then summarize the result in plain language.`,
      toolCall: {
        id: 'call_weather_1',
        name: 'get_weather',
        input: { location, units: 'metric' },
        output: {
          location,
          temperature_c: 22,
          condition: 'Partly cloudy',
          humidity: 0.58,
          wind_kmh: 12,
          wind_direction: 'E',
        },
      },
      text: REPLY_TEXTS.weather.replace('Tokyo', location),
    };
  }

  if (p.includes('code') || p.includes('sample') || p.includes('install')) {
    return {
      reasoning: "Showing the smallest possible Chorus integration — a single import plus one component.",
      text: REPLY_TEXTS.code,
    };
  }

  if (p.includes('summar') || p.includes('feature') || p.includes('what can')) {
    return {
      reasoning: 'Compiling the headline features the user would notice in the first 30 seconds.',
      text: REPLY_TEXTS.summary,
    };
  }

  if (p.includes('markdown')) {
    return {
      reasoning: 'A quick tour through the markdown primitives Chorus renders out of the box.',
      text: REPLY_TEXTS.markdown,
    };
  }

  return {
    reasoning: 'No special intent detected — falling back to the default playground response.',
    text: REPLY_TEXTS.default,
  };
}

function tokenize(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [text];
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('Aborted'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal.reason ?? new Error('Aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function sseLine(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

async function* streamSSE(plan: StreamPlan, signal: AbortSignal): AsyncGenerator<string> {
  if (plan.reasoning) {
    for (const token of tokenize(plan.reasoning)) {
      await sleep(DEMO_CHUNK_DELAY_MS, signal);
      yield sseLine({ choices: [{ index: 0, delta: { reasoning_content: token } }] });
    }
  }

  if (plan.toolCall) {
    await sleep(DEMO_CHUNK_DELAY_MS * 3, signal);
    yield sseLine({
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: plan.toolCall.id,
            function: {
              name: plan.toolCall.name,
              arguments: JSON.stringify(plan.toolCall.input),
            },
            output: plan.toolCall.output,
          }],
        },
      }],
    });
    await sleep(DEMO_CHUNK_DELAY_MS * 4, signal);
  }

  for (const token of tokenize(plan.text)) {
    await sleep(DEMO_CHUNK_DELAY_MS, signal);
    yield sseLine({ choices: [{ index: 0, delta: { content: token } }] });
  }

  yield 'data: [DONE]\n\n';
}

const mockTransport: Transport = (text, _history, signal) => {
  const plan = planFor(text);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const evt of streamSSE(plan, signal)) {
          controller.enqueue(encoder.encode(evt));
        }
      } catch (err) {
        if (!signal.aborted) {
          controller.error(err);
          return;
        }
      } finally {
        try { controller.close(); } catch {}
      }
    },
    cancel() {
      // ReadableStream cancelled from the consumer side; nothing to clean up.
    },
  });

  return Promise.resolve(new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  }));
};

function App() {
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
            radial-gradient(1100px 600px at 85% -10%, rgba(99,102,241,0.14), transparent 60%),
            radial-gradient(900px 500px at -10% 110%, rgba(139,92,246,0.10), transparent 60%),
            #0b0b0d;
          color: #e7e7ea;
          min-height: 100dvh;
        }
        .pg-shell {
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          padding: 24px 20px;
          gap: 16px;
        }
        .pg-header {
          width: 100%;
          max-width: 1120px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
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
          background: linear-gradient(135deg, #6366f1, #4f46e5);
          color: #fff;
          font-size: 14px;
          box-shadow: 0 6px 16px rgba(99,102,241,0.40);
        }
        .pg-header-meta {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .pg-pill {
          font-size: 12px;
          color: #a1a1aa;
          padding: 4px 10px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 9999px;
          background: rgba(255,255,255,0.02);
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .pg-pill-dot {
          width: 6px;
          height: 6px;
          border-radius: 9999px;
          background: #22c55e;
          box-shadow: 0 0 6px rgba(34,197,94,0.6);
        }
        .pg-body {
          width: 100%;
          max-width: 1120px;
          margin: 0 auto;
          flex: 1 1 auto;
          min-height: 0;
          display: grid;
          grid-template-columns: 240px minmax(0, 1fr);
          gap: 16px;
        }
        .pg-sidebar {
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .pg-sidebar .chorus-conversation-list {
          flex: 1 1 auto;
          min-height: 0;
          background: rgba(20,20,22,0.78);
          border-color: rgba(255,255,255,0.08);
          border-radius: 14px;
          padding: 12px;
          overflow-y: auto;
        }
        .pg-card {
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
          gap: 12px;
          flex-wrap: wrap;
        }
        .pg-card-head-title {
          font-weight: 600;
          color: #fafafa;
          font-size: 13px;
        }
        .pg-notice { color: #fbbf24; }
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
        .pg-card-empty {
          flex: 1 1 auto;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px;
          color: #a1a1aa;
          text-align: center;
          font-size: 14px;
        }
        .pg-footer {
          font-size: 12px;
          color: #71717a;
          text-align: center;
          max-width: 1120px;
          margin: 0 auto;
        }
        .pg-footer a {
          color: #a1a1aa;
          text-decoration: none;
          border-bottom: 1px dashed rgba(255,255,255,0.18);
        }
        .pg-footer a:hover { color: #fafafa; }
        @media (max-width: 800px) {
          .pg-shell { padding: 16px 12px; gap: 12px; }
          .pg-body {
            grid-template-columns: 1fr;
          }
          .pg-sidebar .chorus-conversation-list {
            max-height: 160px;
          }
          .pg-card { padding: 10px; border-radius: 14px; }
        }
      `}</style>
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
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
