import type { BlockDefinition, BlockRenderProps } from './types';

export interface CodeBlockProps {
  code?: string;
  language?: string;
  title?: string;
}

/**
 * Lightweight CodeBlock starter block. Renders as plain `<pre><code>` to keep
 * this entry dependency-free. Hosts that already use `highlight.js` through
 * the Markdown renderer can register their own block that reuses that path.
 */
export function CodeBlockComponent({ code, language, title }: BlockRenderProps<CodeBlockProps> & CodeBlockProps) {
  return (
    <div className="chorus-block-code">
      {title && <div className="chorus-block-code-title">{title}</div>}
      <pre className="chorus-block-code-pre"><code data-chorus-language={language}>{code ?? ''}</code></pre>
    </div>
  );
}

export const CodeBlockBlock: BlockDefinition<CodeBlockProps> = {
  component: CodeBlockComponent,
};
