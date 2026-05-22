# react-chorus Next.js App Router example

This example runs the full `<Chorus>` widget in a Next.js 15 App Router app. The
client component in [`app/page.tsx`](./app/page.tsx) points `transport` at a
same-origin route handler, [`app/api/chat/route.ts`](./app/api/chat/route.ts),
which proxies OpenAI Chat Completions and streams the reply back as SSE using
`react-chorus/server` framing helpers.

This example reflects the [Next.js App Router route handler](../../docs/guide.md#nextjs-app-router-route-handler)
and [Built-in connectors](../../docs/guide.md#built-in-connectors) sections of the
documentation.

## Prerequisites

- Node.js 20.19+ or 22.12+ — the floor declared in this example's `engines.node`.
  (Next.js 15 itself only needs ≥18.18, but every example in this repo
  standardizes on the higher floor to match the library's Vite 8 toolchain,
  which rejects Node 21.x and 22.0–22.11.)
- An `OPENAI_API_KEY`. Without it the route handler throws `Missing
  OPENAI_API_KEY` on the first send and the UI renders a connection-style error.

## Run from a fresh clone

Unlike the Vite examples, this one is a single process — `next dev` serves both
the UI and the `/api/chat` route handler, so you only need **one terminal**.

### 1. Build react-chorus from the repository root

The example consumes the local build via `"react-chorus": "file:../.."`, so the
library must be built before the example can resolve it. Skipping this step is
the most common cause of `Cannot find module 'react-chorus'`.

```bash
npm install
npm run build
```

### 2. Install and start the example

```bash
cd examples/with-next
npm install
```

Set your API key with the command for your shell, then start Next.js:

```bash
# macOS/Linux/POSIX shells
OPENAI_API_KEY=sk-... npm run dev

# Windows PowerShell
$env:OPENAI_API_KEY="sk-..."; npm run dev

# Windows cmd.exe
set OPENAI_API_KEY=sk-... && npm run dev
```

Next prints the local URL (usually <http://localhost:3000>). Open it and send a
message to watch the reply stream in.

## The route handler

`app/api/chat/route.ts` exports `runtime = 'nodejs'` because it uses the
official OpenAI Node client; for the Edge runtime, call OpenAI's REST endpoint
with `fetch` instead and pipe the response through the same SSE headers. Chorus
POSTs `{ prompt, history }` where `history` already includes the new user turn —
the handler maps `history` (not `prompt`) with `toOpenAIChatCompletionsBody` to
avoid sending the latest message to the model twice.

## Attachment limits

The composer accepts images (`accept="image/*"`) and caps each attachment at
**2 MB** (`maxAttachmentBytes={2 * 1024 * 1024}`). Attachments are inlined as
base64 data URLs in the JSON request body. Unlike the Express example, App
Router route handlers have no `express.json({ limit })` equivalent, and
Vercel/serverless hosts commonly cap request bodies near 4.5 MB — keep
`maxAttachmentBytes` below your host's limit (base64 inflates payload size by
~33%) or upload large files to object storage and send URLs instead.

## Troubleshooting

- **`Cannot find module 'react-chorus'`** — you skipped the repo-root build. Run
  `npm install && npm run build` at the repository root, then re-run
  `npm install` in `examples/with-next`.
- **`Missing OPENAI_API_KEY` / connection-style error on first send** —
  `OPENAI_API_KEY` was not set in the shell that started `npm run dev`. Stop the
  dev server, export the key, and start it again.

## Where to look next

- [`app/page.tsx`](./app/page.tsx) — the `<Chorus>` client component and its
  `transport` / `connector` wiring.
- [`app/api/chat/route.ts`](./app/api/chat/route.ts) — the SSE route handler,
  using `toOpenAIChatCompletionsBody` from `react-chorus/provider-requests` and
  the `encodeSSE*` helpers from `react-chorus/server`.
- [`examples/with-openai`](../with-openai) — the same OpenAI proxy as a Vite +
  Express two-terminal setup.
- [Root README](../../README.md) — full API reference and recipes.
