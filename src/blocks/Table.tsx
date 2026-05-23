import React from 'react';
import type { BlockDefinition, BlockRenderProps } from './types';

export interface TableProps {
  columns?: Array<{ key: string; label?: string }>;
  rows?: Array<Record<string, unknown>>;
  sortable?: boolean;
  filterable?: boolean;
}

function cell(value: unknown): React.ReactNode {
  if (value == null) return '';
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

export function Table({ columns, rows, sortable, filterable, emit }: BlockRenderProps<TableProps> & TableProps) {
  const cols = Array.isArray(columns) ? columns : [];
  const data = React.useMemo(() => Array.isArray(rows) ? rows : [], [rows]);
  const [sortKey, setSortKey] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');
  const [filter, setFilter] = React.useState('');

  const filteredRows = React.useMemo(() => {
    if (!filterable || !filter) return data;
    const needle = filter.toLowerCase();
    return data.filter(row => Object.values(row).some(v => String(v ?? '').toLowerCase().includes(needle)));
  }, [data, filter, filterable]);

  const sortedRows = React.useMemo(() => {
    if (!sortable || !sortKey) return filteredRows;
    const copy = filteredRows.slice();
    copy.sort((a, b) => {
      const av = String(a[sortKey] ?? '');
      const bv = String(b[sortKey] ?? '');
      return av.localeCompare(bv) * (sortDir === 'asc' ? 1 : -1);
    });
    return copy;
  }, [filteredRows, sortKey, sortDir, sortable]);

  return (
    <div className="chorus-block-table-wrap">
      {filterable && (
        <input
          className="chorus-block-table-filter"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter…"
          aria-label="Filter table rows"
        />
      )}
      <table className="chorus-block-table">
        <thead>
          <tr>
            {cols.map(col => (
              <th
                key={col.key}
                onClick={sortable ? () => {
                  if (sortKey === col.key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                  else { setSortKey(col.key); setSortDir('asc'); }
                } : undefined}
                className={sortable ? 'chorus-block-table-th--sortable' : undefined}
                data-chorus-sort={sortKey === col.key ? sortDir : undefined}
              >
                {col.label ?? col.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, i) => (
            <tr key={i} onClick={() => emit?.({ toolCall: { name: '__table_row_selected', input: row } })}>
              {cols.map(col => <td key={col.key}>{cell(row[col.key])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const TableBlock: BlockDefinition<TableProps> = {
  component: Table,
};
