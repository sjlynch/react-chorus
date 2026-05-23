import React from 'react';
import type { BlockDefinition, BlockRenderProps } from './types';

export interface ChartProps {
  type?: 'line' | 'bar' | 'area';
  data?: Array<Record<string, unknown>>;
  xKey?: string;
  yKey?: string;
}

/**
 * Built-in Chart starter block. The acceptance criteria reserve this entry
 * point for Recharts: when Recharts is installed, importing
 * `react-chorus/blocks/Chart` is the only path that pulls it in. This module
 * dynamically resolves Recharts so the dependency stays optional. When it is
 * not installed, the block falls back to a small inline SVG sparkline so the
 * generative-UI surface is still functional with zero install footprint.
 */

interface RechartsExports {
  LineChart: React.ComponentType<{ data: Array<Record<string, unknown>>; width: number; height: number; children: React.ReactNode }>;
  BarChart: React.ComponentType<{ data: Array<Record<string, unknown>>; width: number; height: number; children: React.ReactNode }>;
  AreaChart: React.ComponentType<{ data: Array<Record<string, unknown>>; width: number; height: number; children: React.ReactNode }>;
  Line: React.ComponentType<{ type?: string; dataKey: string; stroke?: string }>;
  Bar: React.ComponentType<{ dataKey: string; fill?: string }>;
  Area: React.ComponentType<{ type?: string; dataKey: string; stroke?: string; fill?: string }>;
  XAxis: React.ComponentType<{ dataKey: string }>;
  YAxis: React.ComponentType<unknown>;
  Tooltip: React.ComponentType<unknown>;
}

let rechartsModule: RechartsExports | null = null;
let rechartsAttempted = false;

async function tryLoadRecharts(): Promise<RechartsExports | null> {
  if (rechartsAttempted) return rechartsModule;
  rechartsAttempted = true;
  try {
    const mod = await import(/* @vite-ignore */ 'recharts' as string);
    rechartsModule = mod as unknown as RechartsExports;
  } catch {
    rechartsModule = null;
  }
  return rechartsModule;
}

function InlineSparkline({ data, yKey }: { data: Array<Record<string, unknown>>; xKey?: string; yKey?: string }) {
  const first = data[0] ?? {};
  const yField = yKey ?? Object.keys(first).find(k => typeof first[k] === 'number') ?? 'value';
  const values = data.map(d => Number(d[yField] ?? 0));
  if (!values.length) return <div className="chorus-block-chart chorus-block-chart--empty">No data</div>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 240;
  const h = 80;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg className="chorus-block-chart chorus-block-chart--sparkline" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Chart of ${yField}`}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}

export function Chart({ type, data, xKey, yKey }: BlockRenderProps<ChartProps> & ChartProps) {
  const [recharts, setRecharts] = React.useState<RechartsExports | null>(rechartsModule);
  React.useEffect(() => {
    if (!rechartsAttempted) void tryLoadRecharts().then(setRecharts);
  }, []);

  const series = Array.isArray(data) ? data : [];

  if (!recharts) return <InlineSparkline data={series} xKey={xKey} yKey={yKey} />;

  const x = xKey ?? 'name';
  const y = yKey ?? 'value';
  const { LineChart, BarChart, AreaChart, Line, Bar, Area, XAxis, YAxis, Tooltip } = recharts;
  const W = 360;
  const H = 160;

  if (type === 'bar') {
    return (
      <BarChart data={series} width={W} height={H}>
        <XAxis dataKey={x} />
        <YAxis />
        <Tooltip />
        <Bar dataKey={y} fill="currentColor" />
      </BarChart>
    );
  }
  if (type === 'area') {
    return (
      <AreaChart data={series} width={W} height={H}>
        <XAxis dataKey={x} />
        <YAxis />
        <Tooltip />
        <Area type="monotone" dataKey={y} stroke="currentColor" fill="currentColor" />
      </AreaChart>
    );
  }
  return (
    <LineChart data={series} width={W} height={H}>
      <XAxis dataKey={x} />
      <YAxis />
      <Tooltip />
      <Line type="monotone" dataKey={y} stroke="currentColor" />
    </LineChart>
  );
}

export const ChartBlock: BlockDefinition<ChartProps> = {
  component: Chart,
};
