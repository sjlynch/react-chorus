import type { Transport } from '../../hooks/useChorusStream';
import { makeSSEResponse, sseDone, streamTextTokens } from './sseUtils';

const FIXTURES = {
  codeSample: `Here is a typed React example with multiple code fences:

\`\`\`tsx
import { Chorus, createFetchSSETransport } from 'react-chorus';

const transport = createFetchSSETransport('/api/chat', {
  headers: { Authorization: \`Bearer \${token}\` },
});

export function ChatPanel() {
  return <Chorus transport={transport} connector="openai" />;
}
\`\`\`

And the matching server-side handler:

\`\`\`ts
export async function POST(req: Request) {
  const { history } = await req.json();
  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: \`Bearer \${OPENAI_KEY}\` },
    body: JSON.stringify({ model: 'gpt-4o-mini', stream: true, messages: history }),
  });
  return new Response(upstream.body, {
    headers: { 'content-type': 'text/event-stream' },
  });
}
\`\`\`

Note: every \`<pre><code>\` block gets a built-in **Copy** button.`,

  table: `Here's a comparison table of the three provider connectors that ship in the box:

| Connector | Event shape | Reasoning support | Tool deltas |
|-----------|-------------|-------------------|-------------|
| \`openai\` | \`choices[0].delta\` and \`response.*\` | \`reasoning_content\` | \`tool_calls[]\` |
| \`anthropic\` | \`message_*\`, \`content_block_*\` | \`thinking\` blocks | \`tool_use\` + \`input_json_delta\` |
| \`gemini\` | \`candidates[0].content.parts\` | \`thought\` parts | \`functionCall\` parts |

The \`auto\` connector sniffs the shape and dispatches automatically — useful for proxies that bridge multiple providers.`,

  tour: `## A quick formatting tour

You get every primitive **without configuring marked**:

1. Ordered and *unordered* lists
2. \`inline code\` with monospaced rendering
3. [External links](https://github.com/sjlynch/react-chorus) (opens in new tab)
4. ~~strikethrough~~ and **bold _nested_ italics**

> Block quotes are rendered with a left accent and preserved whitespace.
> A second quote line keeps wrapping properly.

A horizontal rule:

---

And of course inline code mixed with prose: when you do \`npm install react-chorus\`, the runtime deps (\`marked\`, \`dompurify\`, \`highlight.js\`) install alongside but stay externalised in the build.`,

  default: `Markdown rendering is on by default. While the message streams, Chorus shows escaped plain text; once \`finalizeAssistant\` runs, the bubble re-renders as parsed and sanitized HTML in a single swap.

Try one of the suggested prompts above to see code highlighting, tables, and a formatting tour.`,
};

function pickReply(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes('code') || p.includes('sample') || p.includes('snippet')) return FIXTURES.codeSample;
  if (p.includes('table')) return FIXTURES.table;
  if (p.includes('tour') || p.includes('format') || p.includes('markdown')) return FIXTURES.tour;
  return FIXTURES.default;
}

export const markdownTransport: Transport = (text, _history, signal) => {
  const reply = pickReply(text);
  return makeSSEResponse(async function* (sig) {
    yield* streamTextTokens(reply, sig);
    yield sseDone();
  }, signal);
};
