/**
 * Tiny line-based LCS diff. Returns a flat array of `{ kind, text }` lines
 * where `kind` is `'eq' | 'add' | 'del'`. This is intentionally minimalist so
 * the artifact panel can ship without pulling in the full `diff` library;
 * the generative-UI work can swap this for `jsdiff` later behind the same
 * `DiffLine` shape.
 */
export type DiffLineKind = 'eq' | 'add' | 'del';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export function diffLines(a: string, b: string): DiffLine[] {
  const left = a.split('\n');
  const right = b.split('\n');
  const m = left.length;
  const n = right.length;

  // LCS table flattened to a single Int32Array for tight indexing; (m+1) rows
  // by (n+1) cols. O(m*n) — fine for the typical artifact range; Myers would
  // be the upgrade if profiling ever flags it.
  const cols = n + 1;
  const lcs = new Int32Array((m + 1) * cols);
  const at = (i: number, j: number) => lcs[i * cols + j]!;
  const set = (i: number, j: number, value: number) => { lcs[i * cols + j] = value; };
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (left[i] === right[j]) {
        set(i, j, at(i + 1, j + 1) + 1);
      } else {
        set(i, j, Math.max(at(i + 1, j), at(i, j + 1)));
      }
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    const li = left[i] ?? '';
    const rj = right[j] ?? '';
    if (li === rj) {
      out.push({ kind: 'eq', text: li });
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      out.push({ kind: 'del', text: li });
      i++;
    } else {
      out.push({ kind: 'add', text: rj });
      j++;
    }
  }
  while (i < m) {
    out.push({ kind: 'del', text: left[i++] ?? '' });
  }
  while (j < n) {
    out.push({ kind: 'add', text: right[j++] ?? '' });
  }
  return out;
}
