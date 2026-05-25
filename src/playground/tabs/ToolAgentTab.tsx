import React from 'react';
import { Chorus } from '../../Chorus';
import { defineTool } from '../../tools';
import type { ChorusToolPolicy, ChorusToolRegistry } from '../../Chorus';
import type { Message, Role } from '../../types';
import { DEMO_PALETTE } from './palettes';
import { toolAgentTransport } from './toolAgentTransport';
import { lookupWeather, type WeatherFixture } from './weatherFixtures';

const WELCOME_MESSAGE: Message = {
  id: 'welcome-tool-agent',
  role: 'assistant',
  text: "This tab opts into `autoContinueTools`. When you ask for weather, the mock transport returns **only tool calls** — Chorus runs the `get_weather` handlers from a JS registry, then the transport sees the tool outputs in history and emits the synthesized answer on the second pass.\n\n**Toggle “Require approval”** below to mark `get_weather` as `requiresApproval` and set `toolPolicy: { default: 'ask' }`. Each tool row turns into an Allow once / Allow always / Deny gate before the handler runs; `Allow always` persists per-tool under `react-chorus-pg:tool-agent::tool-policy`.\n\nThe **Tool log** below the chat shows every `onToolCall` invocation in real time.",
};

const SUGGESTED_PROMPTS = [
  'Compare weather in Tokyo and Paris',
  "What's the weather in San Francisco?",
  'Compare London and New York',
];

interface ToolLogEntry {
  id: string;
  name: string;
  iteration: number;
  input: unknown;
  output: unknown;
  at: number;
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return { raw }; }
  }
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  return {};
}

export function ToolAgentTab() {
  const [log, setLog] = React.useState<ToolLogEntry[]>([]);
  const iterationRef = React.useRef(0);
  const seenIdsRef = React.useRef<Set<string>>(new Set());
  const [showToolMessages, setShowToolMessages] = React.useState(true);
  const [requireApproval, setRequireApproval] = React.useState(false);
  const hiddenRoles = React.useMemo<Role[]>(() => showToolMessages ? ['system'] : ['system', 'tool'], [showToolMessages]);

  const tools = React.useMemo<ChorusToolRegistry>(() => ([
    defineTool({
      name: 'get_weather',
      description: 'Look up current weather for a city.',
      requiresApproval: requireApproval,
      inputSchema: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name' },
          units: { type: 'string', enum: ['metric', 'imperial'] },
        },
        required: ['location'],
      },
      handler: (rawInput) => {
        const input = parseArguments(rawInput);
        const location = typeof input.location === 'string' ? input.location : 'Tokyo';
        return lookupWeather(location);
      },
    }),
  ]), [requireApproval]);

  const toolPolicy = React.useMemo<ChorusToolPolicy | undefined>(
    () => requireApproval ? { default: 'ask' } : undefined,
    [requireApproval],
  );

  const handleStreamDone = React.useCallback(() => {
    iterationRef.current += 1;
  }, []);

  const handleClear = React.useCallback(() => {
    iterationRef.current = 0;
    seenIdsRef.current = new Set();
    setLog([]);
  }, []);

  return (
    <div className="pg-tab-stack">
      <Chorus
        transport={toolAgentTransport}
        connector="openai"
        persistenceKey="react-chorus-pg:tool-agent"
        initialMessages={[WELCOME_MESSAGE]}
        suggestedPrompts={SUGGESTED_PROMPTS}
        placeholder="Try “Compare weather in Tokyo and Paris”…"
        showClearButton
        palette={DEMO_PALETTE}
        hiddenRoles={hiddenRoles}
        tools={tools}
        toolPolicy={toolPolicy}
        autoContinueTools
        maxToolIterations={4}
        onClear={handleClear}
        onStreamDone={handleStreamDone}
        onToolCall={(ctx) => {
          if (seenIdsRef.current.has(ctx.id)) return;
          seenIdsRef.current.add(ctx.id);
          const entry: ToolLogEntry = {
            id: ctx.id,
            name: ctx.name,
            iteration: iterationRef.current,
            input: ctx.input,
            output: ctx.output as WeatherFixture | undefined,
            at: Date.now(),
          };
          setLog(prev => [...prev, entry].slice(-10));
        }}
      />

      <aside className="pg-tool-log" aria-label="Tool call log">
        <header className="pg-tool-log-head">
          <span className="pg-tool-log-title">Tool log</span>
          <label className="pg-toggle">
            <input
              type="checkbox"
              checked={requireApproval}
              onChange={(e) => setRequireApproval(e.target.checked)}
            />
            Require approval
          </label>
          <label className="pg-toggle">
            <input
              type="checkbox"
              checked={showToolMessages}
              onChange={(e) => setShowToolMessages(e.target.checked)}
            />
            Show tool messages
          </label>
        </header>
        {log.length === 0 ? (
          <p className="pg-tool-log-empty">No tool calls yet. Send a weather prompt above.</p>
        ) : (
          <ul className="pg-tool-log-list">
            {log.map(entry => (
              <li key={entry.id} className="pg-tool-log-row">
                <span className="pg-tool-log-name">{entry.name}</span>
                <span className="pg-tool-log-iter">iter {entry.iteration}</span>
                <code className="pg-tool-log-io">in {JSON.stringify(entry.input)}</code>
                <code className="pg-tool-log-io">out {JSON.stringify(entry.output)}</code>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
