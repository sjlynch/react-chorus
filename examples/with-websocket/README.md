# react-chorus WebSocket example

A full-stack demo of `createWebSocketTransport`: a Vite-served React frontend
talks to a tiny local `ws` server over a WebSocket. The server streams
Anthropic Messages frames; the WebSocket transport treats each inbound frame as
one SSE payload, so the built-in `anthropic` connector parses
`content_block_delta` / `message_stop` exactly as it would over HTTP SSE.

The bundled server uses **canned frames**, so the demo runs with no API key.

This example reflects the [Using the WebSocket transport](../../README.md#using-the-websocket-transport)
and [Anthropic SSE format](../../README.md#anthropic-sse-format) sections of the
root README.

## Prerequisites

- Node.js 20.19+ or 22.12+ (required by the example's `vite: ^8` toolchain)
- No API keys — the bundled `ws` server generates the reply locally.

## Run from a fresh clone

You'll need **two terminals**: one for the `ws` server on port 8787, one for the
Vite dev server.

### 1. Build react-chorus from the repository root

```bash
npm install
npm run build
```

### 2. Terminal 1 — mock WebSocket backend (port 8787)

```bash
cd examples/with-websocket/server
npm install
npm start
```

The server logs `Mock Anthropic WebSocket backend listening on ws://localhost:8787`.
Override the port with `PORT=9000 npm start`; if you do, update `WS_URL` in
[`../src/App.tsx`](./src/App.tsx) to match.

### 3. Terminal 2 — Vite frontend

```bash
cd examples/with-websocket
npm install
npm run dev
```

Vite prints the local URL (usually <http://localhost:5173>). Send a message and
watch the reply stream in over the WebSocket.

## Wiring a real Anthropic backend

Keep your `ANTHROPIC_API_KEY` on the server. Replace the canned-frame block in
[`server/index.js`](./server/index.js) with the streaming Claude backend from
the root README's [Minimal Node.js `ws` + Claude backend](../../README.md#minimal-nodejs-ws--claude-backend)
recipe — it forwards raw Anthropic SDK events verbatim, which the `anthropic`
connector already understands. The frontend wiring in `src/App.tsx` does not
change.

## Where to look next

- [`src/App.tsx`](./src/App.tsx) — `createWebSocketTransport` + `useChorusStream` wiring.
- [`server/index.js`](./server/index.js) — the mock `ws` backend and its frame shape.
- [`examples/with-anthropic`](../with-anthropic) — the same `anthropic` connector over an HTTP SSE transport.
- [Root README](../../README.md) — full API reference and recipes.
