# react-chorus multi-model side-by-side example

A zero-backend Vite demo that fans **one prompt to three providers in
parallel**, streams the replies into three columns, and lets the user
**pick a winner** that becomes the canonical column going forward. Each
column is a stock `<Chorus>` instance — the example doesn't use any
private internals or library forks.

> Composability example, not a library export. When the branching-DAG
> task and the parallel-sibling-streaming follow-up land, this example
> becomes the design template for a real `<MultiChorus>` library export
> backed by a single conversation with N sibling assistant branches per
> user turn (see "v2" below). Until then, this v1 host-side composition
> ships as marketing/demo material that proves the streaming pipeline is
> already composable on top of today's public API.

## What it demonstrates

- A shared composer in the parent (textarea + suggested-prompt chips +
  Send/Stop) drives N independent `<Chorus>` columns through each one's
  imperative `ref.send(text)`.
- Each column has its own `transport` + `connector` pair, so the
  built-in OpenAI / Anthropic / Gemini connectors each parse the SSE
  shape they were designed for. Swap the mock transports for real proxy
  routes and the rest of the wiring is unchanged.
- The three columns stream independently — one can finish or error
  without affecting its siblings, and `ref.stop()` aborts them in
  parallel.
- "Pick winner" marks the chosen column canonical (accent border + ★)
  and **drops the losers' last turn** by trimming everything from their
  last user message onward via controlled `value` + `onChange`. Future
  prompts route only to the winner.
- Reset clears every column back to an empty transcript and re-enables
  parallel fan-out.

## Prerequisites

- Node.js 20.19+ or 22.12+
- No API keys — every reply is generated locally by the mock transports
  in `src/App.tsx`. Each mock emits the exact SSE frames its connector
  parses (OpenAI Chat deltas, Anthropic `content_block_delta`s, Gemini
  `candidates` chunks).

## Run from a fresh clone

```bash
# 1. Build react-chorus from the repository root.
npm install
npm run build

# 2. Install and start the example.
cd examples/multi-model
npm install
npm run dev
```

Vite prints the local URL (usually <http://localhost:5173>).

## How the composition works

The whole example is built on existing public surface:

| Need                                       | API it uses                              |
| ------------------------------------------ | ---------------------------------------- |
| Per-column streaming transport             | `transport` + `connector` props          |
| Shared composer fan-out                    | `ChorusRef.send(text)` per column        |
| Parent observes / rewrites each transcript | controlled `value` + `onChange` props    |
| Cancel everything                          | `ChorusRef.stop()` per column            |
| Stream-state tracking                      | `onChunk`, `onFinish`, `onAbort`, `onError` |
| Hide each column's built-in composer       | One CSS rule scoped to the column wrapper |

There is **no `MultiChorus` library code** — the orchestration is just
~250 lines of host React in `src/App.tsx`. If you want to ship a
production version with persistence, conversation switching, attachments,
or model badges, drop in the rest of the existing `<Chorus>` props per
column; nothing has to change in the library.

## Picking a winner

`Pick winner` is gated until every column has produced an assistant
reply and no column is mid-stream. The host then:

1. Tags the chosen column as `winner` (accent border + ★ badge).
2. Trims the **other** columns' transcripts from their last user message
   onward, so the loser histories no longer contain the just-completed
   turn. Future prompts will be appended to the rolled-back state.
3. Skips loser columns on the next `submit()` — only the winner gets
   new turns. `Reset all` re-enables fan-out and clears every column.

The rollback is fully host-side: the example mutates its own
`messagesByColumn` state and Chorus picks it up via controlled mode. No
library code is involved.

## Foreshadowing v2: `<MultiChorus>` library export

The strongest version of this lands **after** two prerequisite tasks
ship:

- **Branching DAG**: each model's reply becomes a sibling branch of the
  user turn instead of a separate conversation.
- **Parallel sibling streaming**: a single assistant-session can fan one
  user turn out to N providers concurrently, each writing into its own
  sibling.

At that point this example becomes a single `<MultiChorus models={[…]} />`
library component backed by **one** shared conversation with N sibling
assistant branches per user turn. "Pick winner" turns into
`session.promoteSibling(id)`, which marks the chosen branch as the
canonical path; the other siblings stay accessible behind a sibling
switcher (the same UI that toggles regenerated replies) instead of being
trimmed off entirely. Model badges on each sibling bubble identify which
provider produced the reply, reusing the `message.provider` /
`message.modelId` fields already populated by the multi-provider router.

Until that lands, this `examples/multi-model/` directory is the
canonical reference: **proof that the streaming pipeline is composable
enough to ship multi-model UX today, with no library-core changes.**
