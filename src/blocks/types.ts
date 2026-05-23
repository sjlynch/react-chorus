import type React from 'react';

/**
 * Result of a block-prop validator. `ok: true` returns the (optionally
 * narrowed/transformed) `props` that the block component will receive;
 * `ok: false` carries a list of error strings the fallback can display.
 */
export type BlockValidateResult<T = unknown> =
  | { ok: true; props: T }
  | { ok: false; errors: string[] };

/**
 * Validator adapter accepted by `BlockDefinition.validate`. Intentionally
 * dependency-free so consumers can use Zod, Valibot, JSON Schema, or any
 * other validator without `react-chorus` having to peer-depend on it.
 */
export type BlockValidator<T = unknown> = (props: unknown) => BlockValidateResult<T>;

/**
 * Props injected into every block component by `BlockRenderer`. A block
 * component author may extend these with the block-specific prop shape.
 */
export interface BlockRenderProps<TProps = unknown> {
  /** Streamed (possibly partial) props parsed from the model output. */
  props: TProps;
  /** Whether props are still streaming. Block components should handle partial props gracefully. */
  streaming: boolean;
  /**
   * Interactive emit channel. `emit(text)` synthesizes a user message and
   * triggers the next assistant turn. `emit({ toolCall })` runs a registered
   * tool directly without a visible user message.
   */
  emit: BlockEmit;
}

/**
 * Interactive emit channel available to block components. Available variants:
 *
 * - `emit(text)` synthesizes a user message (visible in the transcript) and
 *   triggers the next assistant turn through the normal send pipeline.
 * - `emit({ toolCall: { name, input } })` invokes a registered tool directly
 *   without producing a user-visible turn — useful for CalendarPicker
 *   "select date" → `book_meeting` flows.
 *
 * Untrusted block code cannot reach the host's network through this channel;
 * it can only send user text or trigger a registered tool from the
 * `<Chorus tools>` registry.
 */
export type BlockEmit = (payload: string | BlockEmitPayload) => void;

export interface BlockEmitPayload {
  /** Plain text — synthesizes a visible user message. Mutually exclusive with `toolCall`. */
  text?: string;
  /** Tool invocation — fires the registered tool handler without producing a user message. */
  toolCall?: { name: string; input?: unknown };
}

/**
 * Block definition stored in the `<Chorus blocks>` registry. Keyed by block
 * name; the assistant references the same name in its `__render_block` tool
 * call.
 */
export interface BlockDefinition<TProps = unknown> {
  /** React component rendered with the (possibly partial) streamed props. */
  component: React.ComponentType<BlockRenderProps<TProps> & TProps>;
  /**
   * Optional validator run when `status === 'done'`. A failing validator
   * renders the validation-error fallback instead of the component, so the
   * block never sees obviously wrong props.
   */
  validate?: BlockValidator<TProps>;
  /**
   * Defer rendering until the streamed props are complete. When `'whole'`,
   * `BlockRenderer` shows a placeholder while the prop JSON is still
   * accumulating. Defaults to `'partial'` (re-render on every delta).
   */
  streamingMode?: 'partial' | 'whole';
}

/** Map of block name → definition. Passed to `<Chorus blocks>`. */
export type BlockRegistry = Record<string, BlockDefinition<unknown>>;

/**
 * Per-tool loader resolution. Pass a record keyed by tool name, or a function
 * `(toolName, partialInput) => ReactNode` to react to streamed input. Both
 * variants fall back to the built-in default loader for unmapped tools.
 */
export type ToolLoadingComponents =
  | Record<string, React.ComponentType<ToolLoaderProps> | React.ReactNode>
  | ((toolName: string, partialInput: unknown) => React.ReactNode);

export interface ToolLoaderProps {
  /** Resolved tool name. */
  toolName: string;
  /** Streamed (possibly partial) tool input. */
  input: unknown;
}
