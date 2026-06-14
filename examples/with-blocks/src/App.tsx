import 'react-chorus/styles.css';
import React from 'react';
import { Chorus } from 'react-chorus';
import type { Transport, ChorusToolRegistry } from 'react-chorus';
import {
  Card,
  Form,
  Table,
  createImageBlock,
  type BlockDefinition,
  type BlockRegistry,
  type BlockRenderProps,
  type ToolLoadingComponents,
} from 'react-chorus/blocks';
import { SpinnerLoader, SkeletonTable } from 'react-chorus/loaders';
import { jsonSchemaAdapter } from 'react-chorus/validators';

// 1. Custom block: a Poll with an inline validator that rejects empty options
//    arrays. The same `{ ok, errors }` contract is what zodAdapter / valibotAdapter
//    produce when wrapped around a real schema.
interface PollProps {
  question?: string;
  options?: string[];
}

function PollCard({ props, streaming, emit }: BlockRenderProps<PollProps>) {
  const opts = Array.isArray(props?.options) ? props.options : [];
  const [picked, setPicked] = React.useState<string | null>(null);
  return (
    <div className="poll-card">
      <p className="poll-card-title">{props?.question || 'Loading question…'}</p>
      <div className="poll-card-options">
        {opts.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`poll-card-option ${picked === opt ? 'poll-card-option--picked' : ''}`}
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
      {picked && <p className="poll-card-status">Vote sent: {picked}</p>}
    </div>
  );
}

// `jsonSchemaAdapter` accepts any compiled-validator-style function that returns
// true/false and exposes an `errors` array on failure (the Ajv contract). For
// the example we write the validator by hand to keep the dep tree small; in a
// real app you would import `zodAdapter` from `react-chorus/validators` and pass
// it a Zod schema instance.
const pollValidator = Object.assign(
  (input: unknown): boolean => {
    pollValidator.errors = null;
    if (!input || typeof input !== 'object') {
      pollValidator.errors = [{ message: 'expected an object' }];
      return false;
    }
    const obj = input as Record<string, unknown>;
    const errors: { instancePath?: string; message?: string }[] = [];
    if (typeof obj.question !== 'string' || obj.question.length === 0) errors.push({ instancePath: '/question', message: 'must be a non-empty string' });
    if (!Array.isArray(obj.options) || obj.options.length < 2) errors.push({ instancePath: '/options', message: 'must list at least two options' });
    if (errors.length > 0) {
      pollValidator.errors = errors;
      return false;
    }
    return true;
  },
  { errors: null as { instancePath?: string; message?: string }[] | null },
);

// 2. Host-configured Image block: `createImageBlock` pins `allowedProtocols` in
//    host code and strips any `allowedProtocols` / `blockedLabel` the model
//    streams, so an untrusted model output can never widen the URL whitelist.
//    Add `'http://localhost'` for dev-server screenshots.
const imageBlock = createImageBlock({
  allowedProtocols: ['https:', 'data:image/', 'http://localhost'],
});

const BLOCKS: BlockRegistry = {
  // Starter blocks shipped from `react-chorus/blocks` — register the packaged
  // `BlockDefinition` directly when you want the default component, or pass
  // `{ component: ... }` to use your own wrapper.
  card: { component: Card as React.ComponentType<BlockRenderProps<unknown>> },
  form: { component: Form as React.ComponentType<BlockRenderProps<unknown>> },
  table: { component: Table as React.ComponentType<BlockRenderProps<unknown>> },
  image: imageBlock as BlockDefinition<unknown>,
  // Custom block + a validator that runs once props finish streaming. A
  // failing validator renders Chorus's built-in error fallback instead of the
  // component, so PollCard never sees malformed props.
  poll: {
    component: PollCard as React.ComponentType<BlockRenderProps<unknown>>,
    validate: jsonSchemaAdapter(pollValidator),
  } as BlockDefinition<unknown>,
};

// 3. Per-tool loaders shipped from `react-chorus/loaders`. Anything streaming
//    a `search_*` tool call shows the table skeleton; everything else falls
//    back to the generic spinner.
const TOOL_LOADERS: ToolLoadingComponents = {
  search_docs: SkeletonTable,
  default: SpinnerLoader,
};

const TOOLS: ChorusToolRegistry = {
  search_docs: () => ({ rows: [{ title: 'react-chorus blocks docs', url: '/docs/api.md#react-chorusblocks' }] }),
};

// 4. Mock transport: zero-backend SSE that emits OpenAI-shape `__render_block`
//    tool calls so the wiring matches what a real provider would send.
const sseLine = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
const sseDone = () => 'data: [DONE]\n\n';

function planForPrompt(text: string): { intro: string; block?: { name: string; props: unknown }; tool?: { name: string; input: unknown } } {
  const lower = text.toLowerCase();
  if (lower.includes('poll') || lower.includes('vote')) {
    return {
      intro: "Voting helps prioritize — I'll render a poll block. Picking an option sends the next user message automatically.",
      block: { name: 'poll', props: { question: 'Which generative-UI feature is most useful?', options: ['Inline blocks', 'Tool loaders', 'Validator adapters'] } },
    };
  }
  if (lower.includes('form') || lower.includes('signup')) {
    return {
      intro: 'Filling out a quick form inline:',
      block: {
        name: 'form',
        props: {
          title: 'Subscribe to release notes',
          fields: [
            { name: 'email', label: 'Email', type: 'email', required: true },
            { name: 'role', label: 'Role', type: 'text' },
          ],
          submitLabel: 'Subscribe',
        },
      },
    };
  }
  if (lower.includes('image') || lower.includes('logo') || lower.includes('screenshot')) {
    return {
      intro: "Here's the react-chorus logo (served from https:, so the default whitelist accepts it):",
      block: { name: 'image', props: { src: 'https://sjlynch.github.io/react-chorus/favicon.svg', alt: 'react-chorus', width: 96, height: 96 } },
    };
  }
  if (lower.includes('table') || lower.includes('subpath') || lower.includes('exports')) {
    return {
      intro: 'Subpath exports at a glance:',
      block: {
        name: 'table',
        props: {
          columns: [{ key: 'subpath', label: 'Subpath' }, { key: 'purpose', label: 'Purpose' }],
          rows: [
            { subpath: 'react-chorus/blocks', purpose: 'Starter blocks + BlockRenderer + parseStreamingJson' },
            { subpath: 'react-chorus/blocks/Chart', purpose: 'Recharts-or-sparkline Chart block' },
            { subpath: 'react-chorus/loaders', purpose: 'SpinnerLoader / SkeletonTable / MapPing / CodeShimmer' },
            { subpath: 'react-chorus/validators', purpose: 'zodAdapter / valibotAdapter / jsonSchemaAdapter' },
            { subpath: 'react-chorus/pricing', purpose: 'PRICING snapshot + ModelPricing type' },
          ],
        },
      },
    };
  }
  if (lower.includes('search') || lower.includes('docs')) {
    return { intro: 'Searching the docs…', tool: { name: 'search_docs', input: { query: text } } };
  }
  return { intro: 'Try one of the suggested prompts to see a block (or `search docs` to watch a tool loader).' };
}

const mockTransport: Transport = async (text, _history, signal) => {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const enqueue = (line: string) => controller.enqueue(encoder.encode(line));
      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

      try {
        const plan = planForPrompt(text);

        for (const token of plan.intro.match(/\S+\s*|\s+/g) ?? [plan.intro]) {
          if (signal.aborted) return;
          await sleep(20);
          enqueue(sseLine({ choices: [{ index: 0, delta: { content: token } }] }));
        }

        if (plan.block) {
          await sleep(120);
          enqueue(sseLine({
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: 0,
                  id: `call_block_${Date.now()}`,
                  // Chorus reserves `__render_block` and maps the streamed
                  // `{ name, props }` to `message.block` instead of producing
                  // a tool row in the transcript.
                  function: { name: '__render_block', arguments: JSON.stringify(plan.block) },
                }],
              },
            }],
          }));
        }

        if (plan.tool) {
          await sleep(120);
          enqueue(sseLine({
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: 0,
                  id: `call_tool_${Date.now()}`,
                  function: { name: plan.tool.name, arguments: JSON.stringify(plan.tool.input) },
                }],
              },
            }],
          }));
        }

        enqueue(sseDone());
        controller.close();
      } catch (err) {
        if (!signal.aborted) controller.error(err);
      }
    },
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
};

export default function App() {
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        .poll-card { padding: 12px 14px; border-radius: 10px; background: #1f2937; color: #f9fafb; }
        .poll-card-title { margin: 0 0 8px; font-weight: 600; }
        .poll-card-options { display: flex; flex-wrap: wrap; gap: 6px; }
        .poll-card-option { padding: 6px 10px; border-radius: 6px; border: 1px solid #374151; background: #111827; color: #f9fafb; cursor: pointer; }
        .poll-card-option:hover:not(:disabled) { background: #374151; }
        .poll-card-option--picked { background: #4f46e5; border-color: #4f46e5; }
        .poll-card-status { margin: 8px 0 0; font-size: 12px; opacity: 0.75; }
      `}</style>
      <Chorus
        transport={mockTransport}
        connector="openai"
        blocks={BLOCKS}
        toolLoadingComponents={TOOL_LOADERS}
        tools={TOOLS}
        autoContinueTools
        persistenceKey="react-chorus-with-blocks-example"
        suggestedPrompts={[
          'Poll: which feature should we ship next?',
          'Render the subpath exports table',
          'Show me the react-chorus logo image',
          'Search docs for tool loaders',
        ]}
        placeholder="Type a message to render a generative-UI block…"
        showClearButton
        errorMessage="The demo could not stream that reply. Try again."
        onError={(error) => console.error(error)}
      />
    </div>
  );
}
