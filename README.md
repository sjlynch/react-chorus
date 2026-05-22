# react-chorus

Drop a polished, streaming AI chat experience into React — then peel back the layers when you need custom transport, rendering, persistence, tools, attachments, or theming.

[![CI](https://github.com/sjlynch/react-chorus/actions/workflows/ci.yml/badge.svg)](https://github.com/sjlynch/react-chorus/actions/workflows/ci.yml)

**[→ Try the live demo](https://sjlynch.github.io/react-chorus/)** &nbsp;·&nbsp; [![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/sjlynch/react-chorus?file=src%2Fmain.tsx)

The live demo runs entirely in your browser — no backend needed. It drives `<Chorus>` through a mock OpenAI-format SSE transport so you can see streaming replies, reasoning traces, tool calls, multi-conversation persistence, and palette theming with one click. Open it in StackBlitz if you want to edit the source side-by-side, or run `npm run dev` locally.

## Contents

- [Why react-chorus?](#why-react-chorus)
- [Install](#install)
- [Quick start](#quick-start) — the simple `transport` path and the advanced `onSend` callback
- [Choosing a send path](#choosing-a-send-path)
- [Examples](#examples)
- [Documentation](#documentation) — the full reference lives in [`docs/`](./docs)
- [Development and release](#development-and-release)
- [License](#license)

## Why react-chorus?

react-chorus is a composable React chat UI library: render a complete streaming AI conversation with a single `<Chorus>` component, or import the headless hooks and components and build your own shell. It ships SSE parsing, retry/edit/regenerate, Markdown rendering, attachment handling, tool-call rendering, local persistence, and theming so you do not rebuild the common edge cases.

How it compares to the alternatives:

- **Versus Vercel AI SDK:** react-chorus focuses on the visible chat UI and composer UX; pair it with any backend or SDK, including Vercel AI SDK, instead of adopting a specific transport stack. A dedicated [`'ai-sdk'` connector](./docs/guide.md#vercel-ai-sdk-stream-format) understands both AI SDK UI-message-stream JSON and the prefix-coded data-stream protocol so AI SDK routes work without writing a custom parser.
- **Versus assistant-ui:** react-chorus keeps the default path small and direct while still exposing message rendering, streaming, persistence, and theme primitives.
- **Versus rolling your own:** you get SSE parsing, retry/edit/regenerate flows, Markdown, attachment handling, and local persistence without rebuilding the common edge cases.

## Install

```bash
npm install react-chorus
```

Import the stylesheet once at your app entry point:

```tsx
import 'react-chorus/styles.css';
```

react-chorus requires **Node.js 20.19+ or 22.12+** for package installation, server-side usage, and the Vite-powered dev/build tooling. `engines.node` is declared as `>=20.19.0 <21 || >=22.12` — exactly the range the Vite 8 toolchain supports — so installing on Node 20.0–20.18, any 21.x, or 22.0–22.11 emits an `npm WARN EBADENGINE` warning rather than failing silently inside the toolchain later.

## Quick start

Start with the **simple `transport` path**: point Chorus at a server-side SSE endpoint and name the connector that matches your model provider.

```tsx
import 'react-chorus/styles.css';
import { Chorus } from 'react-chorus';

export default function App() {
  return (
    <div style={{ height: '100dvh' }}>
      <Chorus transport="/api/chat" connector="openai" />
    </div>
  );
}
```

`transport` requires an endpoint that returns Server-Sent Events. Chorus POSTs `{ prompt: string, history: Message[] }` to the URL and streams the SSE response into the assistant message automatically. **`history` already includes the latest user turn** — `prompt` is a duplicate convenience copy of that same text, not the next message to append. Map `history` directly on the server and ignore `prompt`; appending `prompt` to `history` will send the new user message to the model twice. See the [Next.js App Router route handler](./docs/guide.md#nextjs-app-router-route-handler), the [Minimal Express + OpenAI backend](./docs/guide.md#minimal-express--openai-backend), or the runnable [`examples/with-next`](./examples/with-next) and [`examples/with-openai`](./examples/with-openai) apps for server-safe proxies.

> **Layout footgun — give Chorus an explicit height.** `<Chorus>` fills its parent, so the wrapper needs an explicit height (for example `100dvh`) for the transcript to scroll internally instead of growing the page. Two things commonly break this when you embed `<Chorus>` in a flex parent. First, the browser-default `margin` on `<body>` makes a `100dvh` child overflow the viewport by exactly that margin and show a stray outer scrollbar — reset it with `body { margin: 0 }`. Second, a flex child will not shrink below its content size by default: inside a `display: flex` parent, give the Chorus wrapper `flex: 1; min-height: 0` rather than a fixed `100dvh` so it fills the remaining space without overflowing.

### Advanced — customize the request with `onSend`

When you need direct control — proxying through a custom client, a non-SSE transport, or modifying messages before they are sent — use the advanced `onSend` callback instead of `transport`. Because `onSend` is just a function, it can also stream a reply with no backend at all, which is handy for prototypes, demos, and tests:

```tsx
import 'react-chorus/styles.css';
import { Chorus, type ChorusOnSend } from 'react-chorus';

const demoReply: ChorusOnSend = async (_text, _messages, helpers) => {
  for (const chunk of ['This quick start runs ', 'without a backend ', 'and still streams.']) {
    if (helpers.signal.aborted) return;
    await new Promise((resolve) => setTimeout(resolve, 120));
    helpers.appendAssistant(chunk);
  }
  helpers.finalizeAssistant();
};

export default function App() {
  return (
    <div style={{ height: '100dvh' }}>
      <Chorus
        onSend={demoReply}
        suggestedPrompts={[
          'Summarize today’s release notes',
          'Draft a customer support reply',
          'Brainstorm three product ideas',
        ]}
      />
    </div>
  );
}
```

When the transcript is empty, `suggestedPrompts` renders starter buttons that fill and focus the composer without auto-sending.

## Choosing a send path

Chorus has exactly two ways to send a message. Pick one:

- **Simple — the `transport` prop.** Pass a URL string, a `{ url, headers, credentials, … }` config object, or a `Transport` function. Chorus handles the POST, the SSE stream, retry/stop/edit/regenerate, and tool-call rendering. This is the right default for any app talking to its own `/api/chat` proxy. Add `connector` to name the provider stream format (`'openai'`, `'anthropic'`, `'gemini'`, `'ai-sdk'`, or the default `'auto'`).
- **Advanced — the `onSend` callback.** A function `(text, messages, helpers) => …` you implement when you need a custom client, a non-SSE transport, or to reshape messages before they are sent. Stream tokens with `helpers.appendAssistant()` / `helpers.finalizeAssistant()`, or return a complete assistant `Message` for a non-streaming reply.

If both are provided, `transport` takes precedence. Both paths render the same transcript and support the same components, hooks, and theming.

**The [usage guide](./docs/guide.md)** documents both paths in full — auth headers and cookies, the WebSocket transport, ready-to-paste Next.js / Express / `ws` backends, the provider request/body helpers, connectors, named SSE events, and the OpenAI / Anthropic / Gemini / Vercel AI SDK stream formats.

## Examples

Runnable examples live in the [`/examples`](./examples) directory. Each declares a Node.js 20.19+ or 22.12+ floor (the range the Vite 8 toolchain supports) and consumes the local build, so build the library once from the repository root before running any of them:

```bash
npm install
npm run build
```

Then `cd` into an example and follow its README — each has full, copy-pasteable run instructions (most are `npm install && npm run dev`):

| Example | Description |
|---------|-------------|
| [`examples/basic`](./examples/basic/README.md) | Zero-backend demo using a simulated streaming response, local persistence, clear/reset, and a custom error banner — great for local development |
| [`examples/multi-conversation`](./examples/multi-conversation/README.md) | Sidebar-driven local conversations with pinned chats, per-chat persistence, and first-message auto-titles |
| [`examples/with-next`](./examples/with-next/README.md) | Next.js App Router example with a serverless `/api/chat` SSE route handler proxying to OpenAI |
| [`examples/with-next-resume`](./examples/with-next-resume/README.md) | Next.js App Router example seeding `initialMessages` from a server-side `loadConversation()` and caching follow-up turns under a per-conversation `persistenceKey` — see the [Server-side history pre-load](./docs/guide.md#server-side-history-pre-load) recipe |
| [`examples/with-openai`](./examples/with-openai/README.md) | Full-stack example: Vite frontend + Express backend proxying to OpenAI |
| [`examples/with-websocket`](./examples/with-websocket/README.md) | `createWebSocketTransport` + the `anthropic` connector talking to a tiny local `ws` server (canned Claude-style frames; README shows the real Anthropic swap) |
| [`examples/with-anthropic`](./examples/with-anthropic/README.md) | The `anthropic` connector parsing Anthropic Messages SSE — runs with a built-in mock stream, README documents the Express proxy |
| [`examples/with-gemini`](./examples/with-gemini/README.md) | The `gemini` connector parsing Gemini `generateContent` SSE — runs with a built-in mock stream, README documents the Express proxy |
| [`examples/with-vercel-ai-sdk`](./examples/with-vercel-ai-sdk/README.md) | The `ai-sdk` connector parsing a Vercel AI SDK UI-message stream — runs with a built-in mock stream, README documents the Next.js route |

`npm run verify:examples` recursively checks example `package.json` metadata, build-smokes every example with a `build` script, and import-resolves the `react-chorus` subpaths used by start-only proxy servers so a breaking change to `react-chorus/server` or `react-chorus/provider-requests` fails CI.

## Documentation

The README above is the happy path. The full reference lives in [`docs/`](./docs):

- **[Usage guide](./docs/guide.md)** — the two send paths in depth, auth headers, the WebSocket transport, the [server-side history pre-load](./docs/guide.md#server-side-history-pre-load) recipe (Next.js loader → `initialMessages` + `persistenceKey`), Next.js / Express / `ws` backends, provider request helpers, connectors, named SSE events, the four provider stream formats, and [using `<Markdown>` and `<ToolCallBlock>` standalone](./docs/guide.md#standalone-components).
- **[API reference](./docs/api.md)** — every `<Chorus>` prop, the `onSend` `helpers`, `ChorusRef`, persistence, `useChorusStream`, the transport factories, custom connectors, tool calls and agent steps, theming, the individual components, and the `Message` shape.
- **[Out-of-band attachment uploads](./docs/uploads.md)** — an end-to-end `uploadAttachment` recipe for large or non-image files (PDFs, big images) that won't fit inline.
- **[Deployment notes](./docs/deployment.md)** — bundle-size budgets, SSR and Markdown sanitization, and a strict Content-Security-Policy guide.
- **[Migration and Upgrading](./docs/migration.md)** — breaking changes, deprecation candidates, and concrete migration paths.

## Development and release

Use Node.js 20.19+ or 22.12+ (the floor the root `package.json` `engines.node` and the Vite toolchain both require), then install dependencies with `npm ci`.

Release/CI quality gates:

```bash
npm run lint              # zero warnings enforced
npm run typecheck
npm test
npm run test:coverage    # coverage uses @vitest/coverage-v8
npm run build
npm run verify:bundle-size
npm run build:playground  # includes the playground bundle-size budget
npm run typecheck:consumer
npm run verify:pack
npm run verify:examples   # installs and build-smokes runnable examples
```

`npm run prepublishOnly` runs the package publish gate through build, bundle-size verification, playground size verification, consumer typecheck, package-content verification, and runnable example verification. PR CI also runs `verify:examples` in the Node matrix and the playground build on Node 22 so examples and the GitHub Pages demo cannot regress unnoticed.

## License

MIT
