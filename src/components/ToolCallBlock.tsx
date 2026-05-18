import React from 'react';
import type { ToolCall } from '../types';
import { DEFAULT_TOOL_CALL_LABELS } from '../labels/toolCall';
import type { ChorusToolCallLabels } from '../labels/types';

function fallbackString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '[Unserializable value]';
  }
}

function formatFunction(value: { name?: string }) {
  return value.name ? `[Function ${value.name}]` : '[Function]';
}

function fmt(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'function') return formatFunction(value);
  if (typeof value === 'symbol') return fallbackString(value);

  const seen = new WeakSet<object>();

  try {
    const serialized = JSON.stringify(value, (_key, next) => {
      if (typeof next === 'bigint') return `${next.toString()}n`;
      if (typeof next === 'function') return formatFunction(next);
      if (typeof next === 'symbol') return fallbackString(next);
      if (next === undefined) return '[undefined]';
      if (typeof next === 'object' && next !== null) {
        if (seen.has(next)) return '[Circular]';
        seen.add(next);
      }
      return next;
    }, 2);

    if (serialized !== undefined) return serialized;
  } catch {}

  return fallbackString(value);
}

function hasOwn(value: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export interface ToolCallBlockProps {
  toolCall: ToolCall;
  labels?: ChorusToolCallLabels;
}

export function ToolCallBlock({ toolCall, labels = DEFAULT_TOOL_CALL_LABELS }: ToolCallBlockProps) {
  const [open, setOpen] = React.useState(false);
  const bodyId = React.useId();
  // Defensive: persisted/custom message arrays may bypass the validating default
  // deserializer and produce a tool-role message without a `toolCall`. Render an
  // empty placeholder rather than throwing inside hasOwn.
  const safeToolCall: ToolCall = toolCall ?? { name: '' };
  const hasInput = hasOwn(safeToolCall, 'input');
  const hasOutput = hasOwn(safeToolCall, 'output');
  const hasBody = hasInput || hasOutput;

  return (
    <div className="chorus-tool-call">
      <button
        type="button"
        className="chorus-tool-call-header"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={hasBody ? bodyId : undefined}
        disabled={!hasBody}
      >
        <span className="chorus-tool-call-name">{safeToolCall.name}</span>
        {hasBody && <span className="chorus-tool-call-chevron" aria-hidden="true">{open ? '▲' : '▼'}</span>}
      </button>
      {hasBody && (
        <div className="chorus-tool-call-body" id={bodyId} hidden={!open}>
          {open && (
            <>
              {hasInput && (
                <div className="chorus-tool-call-section">
                  <div className="chorus-tool-call-label">{labels.input}</div>
                  <pre className="chorus-tool-call-pre">{fmt(safeToolCall.input)}</pre>
                </div>
              )}
              {hasOutput && (
                <div className="chorus-tool-call-section">
                  <div className="chorus-tool-call-label">{labels.output}</div>
                  <pre className="chorus-tool-call-pre">{fmt(safeToolCall.output)}</pre>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
