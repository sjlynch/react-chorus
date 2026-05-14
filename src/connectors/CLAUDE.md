# connectors guide

Connectors parse provider-specific SSE `data:` chunks into shared streaming events for the pipeline.

## Contract

The parsing contract is:

```ts
(chunk: string) => {
  text?: string;
  reasoning?: string;
  toolDelta?: { id: string; name?: string; input?: unknown; output?: unknown };
  done?: boolean;
  error?: string;
} | null
```

`text` appends output, `reasoning` appends the assistant thinking trace, `toolDelta` updates a streamed tool-call message, `done` stops the SSE reader, and `error` carries an in-band provider error; `useChorusStream` throws it so normal error/retry handling runs.

The `Connector` type is exported from `openai.ts` and `connectors.ts`:

```ts
{ name: string; extract: (data: string) => ConnectorResult | null }
```

Known string names use the centralized `ConnectorName` alias in `src/types.ts`.

## Existing connectors

- `openai.ts` — reads selected `choices[0]` text, reasoning, and `tool_calls`; treats `[DONE]` as done.
- `anthropic.ts` — reads `content_block_delta` text/thinking events and `tool_use` / `input_json_delta`; treats `message_stop` as done.
- `gemini.ts` — reads selected `candidates[0]` text/thought/functionCall parts; treats normal `STOP` / `MAX_TOKENS` as done and blocked finish reasons as errors.
- All JSON connectors call `extractErrorMessage()` first to surface provider error payloads as `{ error }`.

## Auto detection

`connectors.ts` exports `autoConnector`, which handles `[DONE]`, parses JSON, checks in-band errors, and dispatches by shape:

- `choices` array => OpenAI
- `candidates` array => Gemini
- `type` starting with `response.` => OpenAI Responses API
- other string `type` field => Anthropic
- otherwise non-empty data is treated as plain text

## Adding a provider

1. Implement `Connector` in a new file.
2. Export it from `connectors.ts` and register its string name in `getConnector()`.
3. If exposing a string option, add the name once to centralized `ConnectorName` in `src/types.ts`; `ChorusProps` and `useChorusStream` import that alias.
4. Add shape detection to `autoConnector` when safe and unambiguous, including error payload handling if needed.
5. Add connector tests for text, reasoning/tool deltas, done, in-band errors, empty/invalid payloads, and auto-detection.
