import React from 'react';
import { Chorus } from '../../Chorus';
import type { ChorusToolRegistry } from '../../Chorus';
import type { BlockRegistry, BlockRenderProps, ToolLoadingComponents } from '../../blocks/types';
import { DEMO_PALETTE } from './palettes';
import { generativeUiTransport } from './generativeUiTransport';

const SUGGESTED_PROMPTS = [
  "Poll: which feature should we ship first?",
  "Help me pick a meeting time",
  "What's the weather in Tokyo?",
];

interface PollProps {
  question: string;
  options: string[];
}

function PollCard({ props, streaming, emit }: BlockRenderProps<PollProps>) {
  const safeOptions = Array.isArray(props?.options) ? props.options : [];
  const [picked, setPicked] = React.useState<string | null>(null);
  return (
    <div className="pg-block-card">
      <div className="pg-block-card-title">{props?.question || 'Loading question…'}</div>
      <div className="pg-block-card-body">
        {safeOptions.map((opt, i) => (
          <button
            key={`${opt}-${i}`}
            type="button"
            className={`pg-block-chip ${picked === opt ? 'pg-block-chip--picked' : ''}`}
            disabled={streaming || picked !== null}
            onClick={() => {
              setPicked(opt);
              emit(`I voted for **${opt}**.`);
            }}
          >
            {opt}
          </button>
        ))}
      </div>
      {streaming && <div className="pg-block-card-status">Streaming options…</div>}
      {picked && <div className="pg-block-card-status">Vote sent: {picked}</div>}
    </div>
  );
}

interface DatePickerProps {
  prompt: string;
  dates: string[];
}

function DatePickerCard({ props, streaming, emit }: BlockRenderProps<DatePickerProps>) {
  const safeDates = Array.isArray(props?.dates) ? props.dates : [];
  const [picked, setPicked] = React.useState<string | null>(null);
  return (
    <div className="pg-block-card">
      <div className="pg-block-card-title">{props?.prompt || 'Pick a slot'}</div>
      <div className="pg-block-card-body">
        {safeDates.map(date => (
          <button
            key={date}
            type="button"
            className={`pg-block-chip ${picked === date ? 'pg-block-chip--picked' : ''}`}
            disabled={streaming || picked !== null}
            onClick={() => {
              setPicked(date);
              emit({ toolCall: { name: 'book_slot', input: { date } } });
            }}
          >
            {date}
          </button>
        ))}
      </div>
      {streaming && <div className="pg-block-card-status">Loading available slots…</div>}
      {picked && <div className="pg-block-card-status">Booking confirmed for {picked}.</div>}
    </div>
  );
}

const BLOCKS: BlockRegistry = {
  poll: { component: PollCard as React.ComponentType<BlockRenderProps<unknown>> },
  datePicker: { component: DatePickerCard as React.ComponentType<BlockRenderProps<unknown>> },
};

function WeatherLoader() {
  return (
    <div className="pg-tool-loader">
      <span className="pg-tool-loader-dot pg-tool-loader-dot--1" />
      <span className="pg-tool-loader-dot pg-tool-loader-dot--2" />
      <span className="pg-tool-loader-dot pg-tool-loader-dot--3" />
      <span className="pg-tool-loader-label">Checking weather…</span>
    </div>
  );
}

const TOOL_LOADERS: ToolLoadingComponents = {
  get_weather: WeatherLoader,
};

const TOOLS: ChorusToolRegistry = {
  book_slot: (input) => {
    const slot = (input && typeof input === 'object' && 'date' in input ? (input as { date: string }).date : 'unknown');
    return { confirmation: `Booked ${slot}`, ok: true };
  },
  get_weather: () => ({ temperature_c: 22, condition: 'Partly cloudy' }),
};

export function GenerativeUITab() {
  return (
    <div className="pg-tab-stack">
      <aside className="pg-tab-intro">
        When you ask for a poll or to <strong>pick a date</strong>, the mock transport emits a <code>__render_block</code> tool call. Chorus maps that into <code>message.block</code> and mounts the registered component inline — no extra tool row. Your <code>&lt;Chorus blocks&gt;</code> registry is the contract.
        <br />
        Try the <strong>weather</strong> prompt to also watch the per-tool loader (<code>toolLoadingComponents</code>) — the 3-dot default is replaced by a custom shimmer while the tool call is still streaming.
      </aside>

      <Chorus
        transport={generativeUiTransport}
        connector="openai"
        persistenceKey="react-chorus-pg:generative-ui"
        suggestedPrompts={SUGGESTED_PROMPTS}
        placeholder="Ask for a poll, a date picker, or the weather…"
        showClearButton
        palette={DEMO_PALETTE}
        blocks={BLOCKS}
        toolLoadingComponents={TOOL_LOADERS}
        tools={TOOLS}
        autoContinueTools
      />
    </div>
  );
}
