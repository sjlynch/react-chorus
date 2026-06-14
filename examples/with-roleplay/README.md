# react-chorus with-roleplay example

A zero-backend Vite demo showing how `<Chorus>` accommodates a roleplay / multi-character chat surface using only the public API. No character-card format, no lorebook editor, no persona UI — just the primitives:

- **`MessageSpeaker` on messages** — every turn carries a `speaker` so the bubble shows the persona/character name and (with `showSpeakerAvatars`) a small circular avatar.
- **`transformRequest`** — fires immediately before each transport request. The example uses it to build a per-turn system prompt from the active character + persona and to inject a tiny keyword-triggered "lorebook" without polluting the persisted transcript.
- **`conversationMetadata`** — persists `{ characterId }` alongside the transcript at `${persistenceKey}::meta`, so the picker remembers the last-used character across reloads.
- **Mock SSE transport** — generates character-flavoured replies by reading the system prompt out of the wire history, so no API key is required.

The goal of this example is to prove the core primitives are enough; a real downstream roleplay package (the [recommended layering](../../README.md#roleplay-layer)) would build a character-card importer, a lorebook editor, a persona switcher, and group-chat orchestration on top of these same hooks.

## What it does not do

- Character card V2/V3 import (`.png` / `.json` decoding)
- A real lorebook editor or vector RAG
- Group chats where multiple AI characters speak in one turn
- Author's notes, rolling summaries, swipes / alternatives

Those belong in the roleplay layer, not in `react-chorus`.

## Prerequisites

- Node.js 20.19+ or 22.12+
- No API keys — replies stream from the mock transport in `src/App.tsx`.

## Run from a fresh clone

```bash
# 1. Build react-chorus from the repository root — the example consumes the
#    local build via "react-chorus": "file:../..".
npm install
npm run build

# 2. Install and start the example
cd examples/with-roleplay
npm install
npm run dev
```

Vite prints the local URL (usually <http://localhost:5173>). Pick a character from the header dropdown and try one of the suggested prompts. Notice that:

- Each turn shows an avatar + name (`Wendy` for you, `Captain Hook` / `Mr. Smee` for the assistant).
- Switching the dropdown changes the next assistant turn — earlier messages keep their original speaker.
- Refreshing keeps the picker on whichever character you last used (`conversationMetadata` round-trip).
- Lorebook entries fire only when their keys appear in the latest user turn — open the browser devtools network panel and watch the system prompt grow when you say "kraken" or "tinker bell".

## Where to look next

- [`src/App.tsx`](./src/App.tsx) — `CHARACTERS` / `PERSONA` / `LORE`, `transformRequest`, the controlled `onChange` tagger, the mock transport.
- [Speaker docs](../../docs/api.md#messagespeaker-and-showspeakeravatars) — the `MessageSpeaker` shape and the `showSpeakerAvatars` prop.
- [`transformRequest` docs](../../docs/api.md#transformrequest) — full contract including idempotency and abort semantics.
- [`conversationMetadata` docs](../../docs/api.md#conversationmetadata) — controlled prop + `useConversationMetadata` hook.
- [Root README](../../README.md) — full API reference.
