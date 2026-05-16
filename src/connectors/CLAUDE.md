# connectors guide

Connectors parse provider-specific SSE `data:` chunks into shared streaming events for the pipeline.

## Contract

The parsing contract is:

```ts
(chunk: string, state?: unknown) => {
  text?: string;
  reasoning?: string;
  toolDelta?: { id: string; name?: string; input?: unknown; output?: unknown };
  toolDeltas?: Array<{ id: string; name?: string; input?: unknown; output?: unknown }>;
  done?: boolean;
  error?: string;
  errorPayload?: unknown;
} | null
```

`text` appends output, `reasoning` appends the assistant thinking trace, `toolDelta`/`toolDeltas` update streamed tool-call messages, `done` stops the SSE reader, and `error` carries an in-band provider error. When present, `errorPayload` is attached to the thrown `ChorusStreamError` so `onError`/`streamRawError` can inspect the provider JSON.

The `Connector` type is exported from `types.ts`, `openai.ts`, and `connectors.ts`:

```ts
{
  name: string;
  createState?: () => unknown;
  extract: (data: string, state?: unknown) => ConnectorResult | null;
  flush?: (state?: unknown) => ConnectorResult | null;
}
```

`useChorusStream` calls `createState()` once per `send()`, passes that object into every `extract()` call, and calls `flush()` once when the response body closes without a provider done sentinel. Stateful connectors must not store per-stream buffers or tool id maps in module globals, because multiple Chorus instances can stream concurrently.

Known string names use the centralized `ConnectorName` alias in `src/types.ts`.

## Existing connectors

- `openai.ts` — public OpenAI facade and state factory. Internals are split under `connectors/openai/`: `thinkTagSplitter.ts` for `<think>` parsing + EOF flush, `chatCompletions.ts` for `choices[].delta`, `responses.ts` for `response.*` events, and `shared.ts` for small result helpers.
- `anthropic.ts` — reads `content_block_delta` text/thinking events and `tool_use` / `input_json_delta`; treats `message_stop` as done.
- `gemini.ts` — reads selected `candidates[0]` text/thought/functionCall parts; treats normal `STOP` / `MAX_TOKENS` as done and blocked finish reasons as errors.
- `aiSdk.ts` — reads Vercel AI SDK output in two shapes: SSE-wrapped UI-message-stream JSON (`text-delta`, `reasoning-delta`, `tool-input-*`, `tool-output-available`, `finish` / `finish-message`, `{ type: 'error', errorText }`) and the prefix-coded data-stream protocol (`0:`, `g:`, `9:`, `b:`, `c:`, `a:`, `d:`, `e:`, `3:`). Unknown frames return null instead of leaking protocol text. Data-stream lines must arrive through SSE — see the README recipe for the one-line server wrap.
- All JSON connectors call `extractErrorMessage()` first and preserve the original provider payload as `errorPayload` when surfacing `{ error }`. `extractErrorMessage` also recognises the AI SDK's `{ type: 'error', errorText }` shape.

## Auto detection

`connectors.ts` exports `autoConnector`, which handles `[DONE]`, parses JSON, checks in-band errors, and dispatches by shape:

- `choices` array => OpenAI
- `candidates` array => Gemini
- `type` starting with `response.` => OpenAI Responses API
- known Anthropic event `type` => Anthropic
- known AI SDK event `type` (`text-delta`, `reasoning-delta`, `tool-input-*`, `tool-output-available`, `finish` / `finish-message` / `finish-step`, `start` / `start-step`, `source-*`, `file`) => AI SDK
- non-JSON data starting with a single-character `<prefix>:` (the AI SDK data-stream protocol) => AI SDK
- otherwise non-empty data is treated as plain text

## Adding a provider

1. Implement `Connector` in a new file. If it needs parser memory, expose `createState()` and thread the state through helper functions.
2. Export it from `connectors.ts` and register its string name in `getConnector()`.
3. If exposing a string option, add the name once to centralized `ConnectorName` in `src/types.ts`; `ChorusProps` and `useChorusStream` import that alias.
4. Add shape detection to `autoConnector` when safe and unambiguous, including `errorPayload` handling and a `flush()` hook if the parser buffers partial output.
5. Add connector tests for text, reasoning/tool deltas, done, in-band errors, EOF flushes, empty/invalid payloads, and auto-detection.
