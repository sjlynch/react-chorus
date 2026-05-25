import { Chorus } from '../../Chorus';
import { DEMO_PALETTE } from './palettes';
import { artifactsTransport } from './artifactsTransport';

const SUGGESTED_PROMPTS = [
  'Build me a Snake game I can play',
  'Write a TypeScript debounce helper',
  'Draft the next release notes',
  'Revise the debounce helper with a leading flag',
];

export function ArtifactsTab() {
  return (
    <div className="pg-tab-stack">
      <aside className="pg-tab-intro">
        When the model emits long content — code, HTML, a document — Chorus aggregates a reserved <code>__artifact</code> tool call into a side panel instead of inflating the transcript. The inline <code>ArtifactCard</code> shows the title with an <strong>Open</strong> button; repeated emissions with the same <code>id</code> stack as versions navigable from the panel header.
        <br />
        Try the prompts below to emit each kind, then ask <em>"revise the debounce helper with a leading flag"</em> to add a second version of the same artifact.
      </aside>

      <Chorus
        transport={artifactsTransport}
        connector="openai"
        persistenceKey="react-chorus-pg:artifacts"
        suggestedPrompts={SUGGESTED_PROMPTS}
        placeholder="Ask for a Snake game, a debounce helper, or release notes…"
        showClearButton
        palette={DEMO_PALETTE}
      />
    </div>
  );
}
