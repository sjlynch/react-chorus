import React from 'react';
import type { MessageBlock } from '../types';
import { useBlockRuntime } from './BlockContext';
import type { BlockDefinition } from './types';

interface BlockErrorBoundaryProps {
  blockName: string;
  rawProps: unknown;
  children: React.ReactNode;
}

interface BlockErrorBoundaryState {
  error: Error | null;
}

/**
 * Per-block error boundary so a thrown block component never tears down the
 * whole transcript. The fallback renders the block name plus a disclosure
 * with the raw JSON props the model emitted, so a reader can still inspect
 * what the assistant tried to render even when the component crashed.
 */
class BlockErrorBoundary extends React.Component<BlockErrorBoundaryProps, BlockErrorBoundaryState> {
  state: BlockErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BlockErrorBoundaryState {
    return { error };
  }

  componentDidCatch() {
    // Intentionally silent: surfacing through the inline error chip is enough.
  }

  render() {
    if (this.state.error) {
      return (
        <BlockErrorFallback
          name={this.props.blockName}
          message={this.state.error.message}
          rawProps={this.props.rawProps}
        />
      );
    }
    return this.props.children;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function BlockErrorFallback({ name, message, rawProps }: { name: string; message: string; rawProps: unknown }) {
  return (
    <div className="chorus-block-fallback chorus-block-fallback--error" data-chorus-block-name={name}>
      <div className="chorus-block-fallback-title">
        <span className="chorus-block-fallback-name">{name}</span>
        <span className="chorus-block-fallback-kind">block error</span>
      </div>
      <div className="chorus-block-fallback-message">{message}</div>
      <details className="chorus-block-fallback-raw">
        <summary>Show raw props</summary>
        <pre>{safeStringify(rawProps)}</pre>
      </details>
    </div>
  );
}

function UnknownBlockFallback({ name, rawProps }: { name: string; rawProps: unknown }) {
  return (
    <div className="chorus-block-fallback chorus-block-fallback--unknown" data-chorus-block-name={name}>
      <div className="chorus-block-fallback-title">
        <span className="chorus-block-fallback-name">{name}</span>
        <span className="chorus-block-fallback-kind">unknown block</span>
      </div>
      <details className="chorus-block-fallback-raw">
        <summary>Show raw JSON</summary>
        <pre>{safeStringify(rawProps)}</pre>
      </details>
    </div>
  );
}

function ValidationErrorFallback({ name, errors, rawProps }: { name: string; errors: string[]; rawProps: unknown }) {
  return (
    <div className="chorus-block-fallback chorus-block-fallback--validation" data-chorus-block-name={name}>
      <div className="chorus-block-fallback-title">
        <span className="chorus-block-fallback-name">{name}</span>
        <span className="chorus-block-fallback-kind">invalid props</span>
      </div>
      <ul className="chorus-block-fallback-errors">
        {errors.map((err, i) => <li key={i}>{err}</li>)}
      </ul>
      <details className="chorus-block-fallback-raw">
        <summary>Show raw props</summary>
        <pre>{safeStringify(rawProps)}</pre>
      </details>
    </div>
  );
}

export interface BlockRendererProps {
  block: MessageBlock;
}

/**
 * Default block renderer used by `MessageBubbleLayout`. Resolves the block
 * by name from the runtime registry, runs the validator on `'done'`, and
 * wraps the component in an error boundary. Returns null when no runtime
 * provider exists (standalone `ChatWindow` outside `<Chorus>`).
 */
export function BlockRenderer({ block }: BlockRendererProps) {
  const { blocks, emit } = useBlockRuntime();
  const def = blocks?.[block.name] as BlockDefinition<unknown> | undefined;

  if (!def) {
    return <UnknownBlockFallback name={block.name} rawProps={block.props} />;
  }

  // Validate-on-done. Streaming intermediate props are intentionally
  // permitted to be partial — block components opt in to partial rendering,
  // or set streamingMode: 'whole' to defer rendering until done.
  let propsForRender = block.props;
  if (block.status === 'done' && def.validate) {
    const result = def.validate(block.props);
    if (!result.ok) {
      return <ValidationErrorFallback name={block.name} errors={result.errors} rawProps={block.props} />;
    }
    propsForRender = result.props;
  }

  if (block.status === 'streaming' && def.streamingMode === 'whole') {
    return (
      <div className="chorus-block chorus-block--pending" data-chorus-block-name={block.name}>
        <span className="chorus-block-pending-label">Rendering {block.name}…</span>
      </div>
    );
  }

  if (block.status === 'error') {
    return (
      <BlockErrorFallback
        name={block.name}
        message={block.error ?? 'Block error'}
        rawProps={block.props}
      />
    );
  }

  const Component = def.component;
  const componentProps = (propsForRender && typeof propsForRender === 'object') ? (propsForRender as Record<string, unknown>) : {};
  return (
    <div className="chorus-block" data-chorus-block-name={block.name} data-chorus-block-status={block.status}>
      <BlockErrorBoundary blockName={block.name} rawProps={block.props}>
        <Component
          {...componentProps}
          props={propsForRender}
          streaming={block.status === 'streaming'}
          emit={emit}
        />
      </BlockErrorBoundary>
    </div>
  );
}

export { BlockErrorFallback, UnknownBlockFallback, ValidationErrorFallback };
