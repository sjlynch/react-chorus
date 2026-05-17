# react-chorus Vite + Express OpenAI example

A full-stack demo: a Vite-served React frontend talks to an Express backend that proxies OpenAI Chat Completions and streams SSE chunks back. Frontend uses `createFetchSSETransport('/api/chat')` with the built-in `openai` connector; Vite proxies `/api` to <http://localhost:3001> in dev (see [`vite.config.ts`](./vite.config.ts)).

This example exercises the [Built-in connectors](../../README.md#built-in-connectors), [`createFetchSSETransport`](../../README.md#createfetchssetransporturl-init), and [Minimal Express + OpenAI backend](../../README.md#minimal-express--openai-backend) sections of the root README.

## Prerequisites

- Node.js 20+
- An `OPENAI_API_KEY`. Without it the backend's first call to OpenAI fails and the frontend renders a connection-style error.

## Run from a fresh clone

You'll need **two terminals** running side-by-side: one for the Express backend on port 3001, one for the Vite dev server.

### 1. Build react-chorus from the repository root

The example and its server both consume the local build via `"react-chorus": "file:../.."` / `"file:../../.."`, so the library must be built first.

```bash
npm install
npm run build
```

### 2. Terminal 1 — Express backend (port 3001)

```bash
cd examples/with-openai/server
npm install
```

Set your API key with the command for your shell, then start the server:

```bash
# macOS/Linux/POSIX shells
OPENAI_API_KEY=sk-... npm start

# Windows PowerShell
$env:OPENAI_API_KEY="sk-..."; npm start

# Windows cmd.exe
set OPENAI_API_KEY=sk-... && npm start
```

The server logs `Backend listening on http://localhost:3001` once it's ready. Override the port with `PORT=4000 npm start` if 3001 is taken; if you do, update the proxy target in `examples/with-openai/vite.config.ts` to match.

The server sets `X-Accel-Buffering: no` so nginx-style reverse proxies don't buffer SSE chunks.

### 3. Terminal 2 — Vite frontend

```bash
cd examples/with-openai
npm install
npm run dev
```

Vite prints the local URL (usually <http://localhost:5173>). The dev server proxies `/api` → `http://localhost:3001`, so the frontend's `createFetchSSETransport('/api/chat')` reaches the Express backend transparently.

## Troubleshooting

- **Connection error / CORS-style failure on first send** — usually means the backend isn't running on port 3001 or `OPENAI_API_KEY` is unset. Check Terminal 1.
- **`Cannot find module 'react-chorus'`** — you skipped `npm run build` at the repo root. Run it once, then re-run `npm install` in `examples/with-openai` and `examples/with-openai/server`.

## Where to look next

- [`src/App.tsx`](./src/App.tsx) — the frontend wiring (transport + `useChorusStream`).
- [`server/index.js`](./server/index.js) — the Express SSE handler, including `toOpenAIChatCompletionsBody` from `react-chorus/provider-requests`.
- [Root README](../../README.md) — full API reference and recipes.
