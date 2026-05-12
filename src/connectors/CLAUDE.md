# connectors guide

Connectors parse provider-specific SSE `data:` chunks into plain text tokens for the shared streaming pipeline.

## Contract

The parsing contract is effectively:

```ts
(chunk: string) => { text?: string; done?: boolean } | null
```

In the current codebase the `Connector` type is an object from `openai.ts`:

```ts
{ name: string; extract: (data: string) => ConnectorResult | null }
```

## Existing connectors

- `openai.ts` — reads `choices[*].delta.content`; treats `[DONE]` as done.
- `anthropic.ts` — reads `content_block_delta` events with `delta.type === 'text_delta'`; treats `message_stop` as done.
- `gemini.ts` — reads `candidates[*].content.parts[*].text`; treats a candidate `finishReason` as done.

## Auto detection

`connectors.ts` exports `autoConnector`, which parses each payload as JSON and dispatches by shape:

- `choices` array => OpenAI
- `candidates` array => Gemini
- string `type` field => Anthropic
- otherwise non-empty data is treated as plain text

## Adding a provider

1. Implement `Connector` in a new file.
2. Export it from `connectors.ts` and register its string name in `getConnector()`.
3. Add shape detection to `autoConnector` when safe and unambiguous.
4. Update connector-name unions in `useChorusStream.ts`, `Chorus.tsx`, and `getConnector()`; if a shared `ConnectorName` alias is introduced, keep it in `types.ts`.
5. Add connector tests for text, done, empty/invalid payloads, and auto-detection.
