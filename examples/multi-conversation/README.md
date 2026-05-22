# react-chorus multi-conversation example

A sidebar-driven Vite demo: `<ConversationList>` + `useConversations` manage multiple local chats with per-conversation persistence, pin/rename, and auto-titles derived from the first message. Replies are simulated locally so the demo runs with no backend.

This example exercises the [`ConversationList`](../../docs/api.md#individual-components) component and the [persistence examples](../../docs/api.md#persistence-examples) section of the documentation.

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
cd examples/multi-conversation
npm install
npm run dev
```

Vite prints the local URL (usually <http://localhost:5173>). Create a few conversations from the sidebar and confirm that each transcript survives a page reload.

## Where to look next

- [`src/App.tsx`](./src/App.tsx) — shows how `useConversations` wires `persistenceKey` and `persistenceStorage` into `<Chorus>` and how `renameFromFirstMessage` produces auto-titles.
- [Root README](../../README.md) — full API reference and recipes.
