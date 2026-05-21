# react-chorus basic example

A zero-backend Vite demo: `<Chorus>` drives a simulated word-by-word streaming reply, persists the transcript to `localStorage`, exposes the clear button, and surfaces a custom error banner. Good for local hacking before you wire up a real model.

This example exercises the [Advanced path — `onSend` callback](../../README.md#advanced-path--onsend-callback) and the [persistence examples](../../README.md#persistence-examples) from the root README.

## Prerequisites

- Node.js 20.19+ or 22.12+ (required by the example's `vite: ^8` toolchain)
- No API keys — replies are generated locally in `src/App.tsx`.

## Run from a fresh clone

```bash
# 1. Build react-chorus from the repository root — the example consumes the
#    local build via "react-chorus": "file:../..".
npm install
npm run build

# 2. Install and start the example
cd examples/basic
npm install
npm run dev
```

Vite prints the local URL (usually <http://localhost:5173>). Type a message and watch the simulated stream.

## Where to look next

- [`src/App.tsx`](./src/App.tsx) — replace the simulated `onSend` with `createFetchSSETransport('/api/chat')` to point at a real backend.
- [`examples/with-openai`](../with-openai) — same shape, but talking to a real OpenAI proxy.
- [Root README](../../README.md) — full API reference and recipes.
