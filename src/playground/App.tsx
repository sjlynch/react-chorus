import React from 'react';
import { ArtifactsTab } from './tabs/ArtifactsTab';
import { AttachmentsTab } from './tabs/AttachmentsTab';
import { GenerativeUITab } from './tabs/GenerativeUITab';
import { MarkdownTab } from './tabs/MarkdownTab';
import { MultiConversationTab } from './tabs/MultiConversationTab';
import { MultiModelTab } from './tabs/MultiModelTab';
import { MultiProviderTab } from './tabs/MultiProviderTab';
import { RoleplayTab } from './tabs/RoleplayTab';
import { StreamingBasicsTab } from './tabs/StreamingBasicsTab';
import { TabRail } from './tabs/TabRail';
import { ThemingTab } from './tabs/ThemingTab';
import { ToolAgentTab } from './tabs/ToolAgentTab';
import type { PlaygroundTab, TabId } from './tabs/types';

const TABS: PlaygroundTab[] = [
  { id: 'streaming-basics', label: 'Streaming basics', subtitle: 'SSE, reasoning, retry', render: () => <StreamingBasicsTab /> },
  { id: 'tool-agent', label: 'Tool agent', subtitle: 'autoContinueTools + approvals', render: () => <ToolAgentTab /> },
  { id: 'multi-provider', label: 'Multi-provider + cost', subtitle: 'providers, /model:, cost meter', render: () => <MultiProviderTab /> },
  { id: 'multi-model', label: 'Multi-model side-by-side', subtitle: 'fan-out, pick winner', render: () => <MultiModelTab /> },
  { id: 'artifacts', label: 'Artifacts', subtitle: '__artifact, side panel, versions', render: () => <ArtifactsTab /> },
  { id: 'generative-ui', label: 'Generative UI', subtitle: 'blocks + tool loaders', render: () => <GenerativeUITab /> },
  { id: 'roleplay', label: 'Roleplay', subtitle: 'speakers, transformRequest, lorebook', render: () => <RoleplayTab /> },
  { id: 'markdown', label: 'Markdown & code', subtitle: 'tables, fences, copy', render: () => <MarkdownTab /> },
  { id: 'attachments', label: 'Attachments', subtitle: 'paste, drop, picker', render: () => <AttachmentsTab /> },
  { id: 'multi-conversation', label: 'Multi-chat', subtitle: 'useConversations + storage', render: () => <MultiConversationTab /> },
  { id: 'theming', label: 'Theming + render', subtitle: 'palette, renderMessage', render: () => <ThemingTab /> },
];

const ACTIVE_TAB_KEY = 'react-chorus-pg:active-tab';
const VALID_TAB_IDS = new Set<TabId>(TABS.map(t => t.id));

function readInitialTabId(): TabId {
  if (typeof window === 'undefined') return TABS[0].id;
  try {
    const stored = window.localStorage.getItem(ACTIVE_TAB_KEY);
    if (stored && VALID_TAB_IDS.has(stored as TabId)) return stored as TabId;
  } catch { /* private mode or storage disabled */ }
  return TABS[0].id;
}

export function App() {
  const [activeId, setActiveId] = React.useState<TabId>(() => readInitialTabId());

  React.useEffect(() => {
    try { window.localStorage.setItem(ACTIVE_TAB_KEY, activeId); } catch { /* ignore */ }
  }, [activeId]);

  const activeTab = TABS.find(t => t.id === activeId) ?? TABS[0];

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
          <span className="pg-pill" title="No live LLM. Replies come from in-browser ReadableStreams.">
            🧪 No backend required
          </span>
          <span className="pg-pill" title="Conversations and messages are saved to localStorage.">
            💾 Persists locally
          </span>
        </span>
      </header>

      <div className="pg-body">
        <TabRail tabs={TABS} activeId={activeId} onSelect={setActiveId} />

        <section
          className="pg-card"
          aria-labelledby={`pg-tab-${activeTab.id}`}
          id={`pg-tabpanel-${activeTab.id}`}
          role="tabpanel"
        >
          <div className="pg-card-head">
            <span className="pg-card-head-title">{activeTab.label}</span>
            <span className="pg-card-head-subtitle">{activeTab.subtitle}</span>
          </div>
          <div className="pg-tab-content">
            {activeTab.render()}
          </div>
        </section>
      </div>

      <p className="pg-footer">
        <a href="https://github.com/sjlynch/react-chorus" target="_blank" rel="noreferrer">View on GitHub</a>
        {' · '}
        <a href="https://www.npmjs.com/package/react-chorus" target="_blank" rel="noreferrer">npm</a>
        {' · '}
        Every tab streams through a mock OpenAI-format SSE transport and the real <code>'auto'</code> connector. No API keys or backend.
      </p>
    </main>
  );
}
