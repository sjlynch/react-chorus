# react-chorus basic example

A zero-backend Vite demo: `<Chorus>` drives a simulated word-by-word streaming reply, persists the transcript to `localStorage`, exposes the clear button, and surfaces a custom error banner. Good for local hacking before you wire up a real model.

This example **intentionally demonstrates the advanced [`onSend` callback path](../../README.md#advanced-path--onsend-callback)**, not the simple `transport` + `connector` form headlined in the root README's [Quick start](../../README.md#quick-start). It uses `onSend` deliberately: a plain function can stream a reply with no backend at all, which is what makes this a zero-setup first-touch demo. For a no-backend demo of the Quick Start `transport` + `connector` pairing instead, see [`examples/with-anthropic`](../with-anthropic) — it pairs a mock `transport` with `connector="anthropic"`, exercising the same wiring as the headline `<Chorus transport="/api/chat" connector="openai" />` snippet. This example also exercises the [persistence examples](../../README.md#persistence-examples) from the root README.

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
