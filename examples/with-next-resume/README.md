# react-chorus Next.js — server-side conversation pre-load

This example runs the [Server-side history pre-load](../../docs/guide.md#server-side-history-pre-load)
recipe end-to-end in a Next.js 15 App Router app. A server component fetches
the conversation transcript inside the request (`loadConversation(id)`), passes
the result into `initialMessages`, and the client component scopes
`persistenceKey` to the conversation id so follow-up turns are cached in the
browser.

It is a strict superset of [`examples/with-next`](../with-next): the OpenAI SSE
route handler is identical, and this app adds the server-fetch wiring on top.

## What the routes demonstrate

| Route | What it shows |
|-------|---------------|
| `/` | Server-rendered list of demo conversation ids and a link to `/c/new`. |
| `/c/[id]` | Server component calls `loadConversation(id)` and seeds `<Chorus initialMessages={...}>`; the client wrapper sets `persistenceKey={`chorus:c:${id}`}` so follow-up turns are cached per conversation. |
| `/c/new` | Server component that redirects to `/c/<server-generated-uuid>`. Mirrors the loader-redirect alternative documented alongside the `useId` / `useEffect` patterns in the guide — the URL is the source of truth for the conversation id, so each new chat starts with an empty stored payload. |
| `/api/chat` | The same OpenAI SSE route handler as [`examples/with-next`](../with-next): consumes Chorus's `{ prompt, history }` payload, maps `history` with `toOpenAIChatCompletionsBody`, and re-emits the OpenAI stream as SSE using `react-chorus/server` helpers. |

## Precedence rule (read before changing the wiring)

`<Chorus>` resolves the visible transcript in this order on every mount when
`persistenceKey` is set without `value`:

1. **A stored payload for this key wins.** `initialMessages` is silently
   dropped from the visible transcript when `persistenceStorage.getItem(key)`
   returns a non-empty value.
2. **No stored payload → `initialMessages` is rendered AND written to
   storage.** First visit seeds the cache.
3. **Async adapters block the composer** until `getItem()` resolves.

The asymmetry is intentional but easy to get wrong: once a browser has any
stored payload under the key, a fresh server fetch is *only* a fallback on
mount. If you want server writes from another device to win on reload,
either drop `persistenceKey` entirely (and use controlled `value` + `onChange`
with a write API), or read the stored payload yourself before mount and call
`localStorage.removeItem(key)` when the server transcript is newer. See the
[Choosing what to trust](../../docs/guide.md#choosing-what-to-trust) table in
the recipe for the full matrix.

## Prerequisites

- Node.js 20.19+ or 22.12+ — the floor declared in this example's
  `engines.node` (same as every other example in this repo).
- An `OPENAI_API_KEY`. Without it the route handler throws
  `Missing OPENAI_API_KEY` on the first send and the UI renders a
  connection-style error.

## Run from a fresh clone

### 1. Build react-chorus from the repository root

```bash
npm install
npm run build
```

### 2. Install and start the example

```bash
cd examples/with-next-resume
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

Next prints the local URL (usually <http://localhost:3000>). Open it, follow a
saved conversation to see the server transcript pre-load, then click
**+ Start a fresh conversation** to land on a unique `/c/<uuid>` with empty
state.

## Where to look

- [`lib/conversations.ts`](./lib/conversations.ts) — the stub `loadConversation(id)`
  with hard-coded fixtures. In a real app this is where you authorize against
  the current session and query your database.
- [`app/c/[id]/page.tsx`](./app/c/[id]/page.tsx) — server component that
  awaits `loadConversation` and renders the client wrapper.
- [`app/c/[id]/ChatClient.tsx`](./app/c/[id]/ChatClient.tsx) — the client
  component wiring `initialMessages` + `persistenceKey` onto `<Chorus>`.
- [`app/c/new/page.tsx`](./app/c/new/page.tsx) — fresh-conversation route
  that redirects to a server-generated uuid.
- [`app/api/chat/route.ts`](./app/api/chat/route.ts) — the OpenAI SSE proxy,
  unchanged from [`examples/with-next`](../with-next).

## Troubleshooting

- **`Cannot find module 'react-chorus'`** — you skipped the repo-root build.
  Run `npm install && npm run build` at the repository root, then re-run
  `npm install` in `examples/with-next-resume`.
- **A fresh conversation shows an old transcript** — your browser has a
  stored payload under the same `persistenceKey`. Either visit `/c/new` to
  get a new uuid, or open DevTools → Application → Local Storage and remove
  the matching `chorus:c:<id>` entry. The precedence rule above is doing
  exactly what it is documented to do.
- **`Missing OPENAI_API_KEY`** — `OPENAI_API_KEY` was not set in the shell
  that started `npm run dev`. Stop the dev server, export the key, and start
  it again.
