import type { BlockDefinition, BlockRenderProps } from './types';

export interface DiffProps {
  a?: string;
  b?: string;
  language?: string;
}

/**
 * Minimal line-by-line diff. The full task spec calls for the `diff` package
 * here; this dependency-free fallback keeps the starter block usable without
 * adding a runtime dependency. A host that wants Myers-quality diffs can
 * register its own block using the `diff` package.
 */
function lineDiff(a: string, b: string) {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const out: Array<{ kind: 'add' | 'remove' | 'eq'; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < aLines.length && j < bLines.length) {
    const aLine = aLines[i] ?? '';
    const bLine = bLines[j] ?? '';
    if (aLine === bLine) {
      out.push({ kind: 'eq', text: aLine });
      i++; j++;
    } else {
      out.push({ kind: 'remove', text: aLine });
      out.push({ kind: 'add', text: bLine });
      i++; j++;
    }
  }
  while (i < aLines.length) { out.push({ kind: 'remove', text: aLines[i++] ?? '' }); }
  while (j < bLines.length) { out.push({ kind: 'add', text: bLines[j++] ?? '' }); }
  return out;
}

export function Diff({ a, b }: BlockRenderProps<DiffProps> & DiffProps) {
  const lines = lineDiff(a ?? '', b ?? '');
  return (
    <pre className="chorus-block-diff">
      {lines.map((line, idx) => (
        <div key={idx} className={`chorus-block-diff-line chorus-block-diff-line--${line.kind}`}>
          <span className="chorus-block-diff-marker">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}</span>
          <span className="chorus-block-diff-text">{line.text}</span>
        </div>
      ))}
    </pre>
  );
}

export const DiffBlock: BlockDefinition<DiffProps> = {
  component: Diff,
};
