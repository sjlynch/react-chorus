import React from 'react';
import type { ToolCall } from '../types';

function fmt(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
}

export function ToolCallBlock({ toolCall }: { toolCall: ToolCall }) {
  const [open, setOpen] = React.useState(false);
  const hasBody = toolCall.input !== undefined || toolCall.output !== undefined;

  return (
    <div className="chorus-tool-call">
      <button
        className="chorus-tool-call-header"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        disabled={!hasBody}
      >
        <span className="chorus-tool-call-name">{toolCall.name}</span>
        {hasBody && <span className="chorus-tool-call-chevron" aria-hidden="true">{open ? '▲' : '▼'}</span>}
      </button>
      {open && hasBody && (
        <div className="chorus-tool-call-body">
          {toolCall.input !== undefined && (
            <div className="chorus-tool-call-section">
              <div className="chorus-tool-call-label">Input</div>
              <pre className="chorus-tool-call-pre">{fmt(toolCall.input)}</pre>
            </div>
          )}
          {toolCall.output !== undefined && (
            <div className="chorus-tool-call-section">
              <div className="chorus-tool-call-label">Output</div>
              <pre className="chorus-tool-call-pre">{fmt(toolCall.output)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
