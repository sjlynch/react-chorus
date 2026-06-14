# react-chorus generative-UI blocks example

A zero-backend Vite demo that wires `<Chorus blocks>` to a mock SSE transport so the assistant can emit inline React components, tool loaders, and a validator-checked custom block — all without an API key.

This example exercises the four block-related subpath exports together:

- [`react-chorus/blocks`](../../docs/api.md#react-chorusblocks) — `Card`, `Form`, `Table`, `Image` starter blocks plus the `BlockDefinition` / `BlockRegistry` types.
- [`react-chorus/loaders`](../../docs/api.md#react-chorusloaders) — `SpinnerLoader` and `SkeletonTable` are wired through `toolLoadingComponents` so each tool call shows a tailored "thinking" state while it streams.
- [`react-chorus/validators`](../../docs/api.md#react-chorusvalidators) — `jsonSchemaAdapter` adapts a hand-rolled validator function into the `BlockValidator` contract. Swap it for `zodAdapter(z.object({...}))` when your app already pulls in Zod.
- The `Image` block is built with `createImageBlock({ allowedProtocols })` so the URL whitelist is pinned in host code; model-streamed `allowedProtocols` / `blockedLabel` are stripped, so an untrusted model output can never widen the whitelist (see the [Image block URL whitelist docs](../../docs/api.md#image-block-url-whitelist-and-createimageblock)).

The mock transport in `src/App.tsx` emits OpenAI-shape SSE chunks with reserved `__render_block` tool calls — the same wire format a real provider would send, so swapping in `transport="/api/chat" connector="openai"` against a real backend keeps the registry wiring identical.

## Prerequisites

- Node.js 20.19+ or 22.12+ (required by the example's `vite: ^8` toolchain)
- No API keys — blocks are streamed from the mock transport in `src/App.tsx`.

## Run from a fresh clone

```bash
# 1. Build react-chorus from the repository root — the example consumes the
#    local build via "react-chorus": "file:../..".
npm install
npm run build

# 2. Install and start the example
cd examples/with-blocks
npm install
npm run dev
```

Vite prints the local URL (usually <http://localhost:5173>). Type one of the suggested prompts (`Poll: which feature…`, `Render the subpath exports table`, `Show me the react-chorus logo image`, `Search docs for tool loaders`) and watch the inline block, the tool-loader skeleton, and the validator fallback when the model emits bad props.

## Where to look next

- [`src/App.tsx`](./src/App.tsx) — the registry, the host-wrapped `Image`, the validator, and the mock transport.
- [`react-chorus/blocks/Chart`](../../docs/api.md#react-chorusblockschart) — separate subpath for the Recharts-or-sparkline `Chart` block (kept out of the default blocks chunk because Recharts is heavy). Add it to the registry the same way: `import { ChartBlock } from 'react-chorus/blocks/Chart';`.
- [Cost meter docs](../../docs/api.md#cost-meter-showcost-pricing-budgetalert) — pair `showCost` with the `transport` path (this example) to see the per-bubble cost chip.
- [Root README](../../README.md) — full API reference and recipes.
