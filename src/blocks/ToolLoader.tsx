import React from 'react';
import type { ToolCall } from '../types';
import { useBlockRuntime } from './BlockContext';
import type { ToolLoaderProps } from './types';

/** Built-in fallback used when no localized `calling` label is supplied. */
const defaultCallingLabel = (toolName: string) => `Calling ${toolName}…`;

/**
 * Default tool loader: 3-dot animation + tool name. Matches the visual
 * vocabulary of the existing typing indicator but is scoped to one tool row.
 *
 * `callingLabel` localizes the screen-reader status. It is kept off the public
 * `ToolLoaderProps` (host loaders never need it) — `ToolLoaderSlot` forwards the
 * resolved `<Chorus labels={{ toolCall: { calling } }}>` string.
 */
export function DefaultToolLoader({ toolName, callingLabel }: ToolLoaderProps & { callingLabel?: (toolName: string) => string }) {
  return (
    <div className="chorus-tool-loader chorus-tool-loader--default" data-chorus-tool-name={toolName}>
      <span className="chorus-tool-loader-label">{toolName}</span>
      <span className="chorus-tool-loader-dots" aria-hidden="true">
        <span /><span /><span />
      </span>
      <span className="chorus-sr-only">{(callingLabel ?? defaultCallingLabel)(toolName)}</span>
    </div>
  );
}

export interface ToolLoaderSlotProps {
  toolCall: ToolCall;
  streaming: boolean;
  /** Localized screen-reader "Calling …" label forwarded to the default loader. */
  callingLabel?: (toolName: string) => string;
}

/**
 * Renders the active per-tool loader for a streaming tool row that has no
 * output yet. Falls back to the default loader when no override exists.
 */
export function ToolLoaderSlot({ toolCall, streaming, callingLabel }: ToolLoaderSlotProps) {
  const { toolLoadingComponents, sending } = useBlockRuntime();
  // Tool-only turns produce no assistant message, so the transcript-level
  // `streamingMessageId` stays null and `streaming` is false even while the
  // stream is still open. Fall back to the session-level `sending` flag so
  // the loader keeps animating for a tool row whose output hasn't arrived.
  const isActive = streaming || (sending === true && toolCall.output === undefined);
  if (!isActive) return null;
  if (toolCall.output !== undefined) return null;
  const toolName = toolCall.name || '';
  const input = toolCall.input;

  if (typeof toolLoadingComponents === 'function') {
    return <>{toolLoadingComponents(toolName, input)}</>;
  }

  const entry = toolLoadingComponents?.[toolName];
  if (entry !== undefined) {
    if (typeof entry === 'function') {
      const C = entry as React.ComponentType<ToolLoaderProps>;
      return <C toolName={toolName} input={input} />;
    }
    return <>{entry}</>;
  }

  return <DefaultToolLoader toolName={toolName} input={input} callingLabel={callingLabel} />;
}
