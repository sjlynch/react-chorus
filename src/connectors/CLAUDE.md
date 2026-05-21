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
  warning?: { code: string; message: string; payload?: unknown };
  warnings?: Array<{ code: string; message: string; payload?: unknown }>;
  metadata?: Record<string, unknown>;
} | null
```

`text` appends output, `reasoning` appends the assistant thinking trace, `toolDelta`/`toolDeltas` update one or more streamed tool-call messages, `done` stops the SSE reader, `error` carries an in-band provider error, `warning`/`warnings` carry non-fatal diagnostics (for example truncation or unsupported Gemini parts — use `warnings` when one chunk produces more than one, `warning` mirrors the first for back-compat), and `metadata` carries provider diagnostics such as safety ratings or response ids. When present, `errorPayload` is attached to the thrown `ChorusStreamError` so `onError`/`streamRawError` can inspect the provider JSON.

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

## Module map

- `connectors.ts` — stable public barrel for connector types, exposed connector singletons (`anthropicConnector`, `geminiConnector`, `aiSdkConnector`, `autoConnector`), `getConnector`, and OpenAI connector options/factory.
- `registry.ts` — `getConnector()` string/custom-object registry plus dev-only warning-once logic for unknown names and ignored connector options.
- `auto.ts` — `autoConnector` facade. Internals are split under `connectors/auto/`: `detection.ts` for provider shape detection, AI SDK UI-message-stream guards, conservative AI SDK data-stream detection, and generic JSON text fallback; `state.ts` for auto state creation, consumer tracking, and flush routing to the first consumer; `dispatch.ts` for the documented auto dispatch order.
- `openai.ts` — public OpenAI facade and state factory. Internals are split under `connectors/openai/`: `thinkTagSplitter.ts` for `<think>` parsing + EOF flush, `chatCompletions.ts` for `choices[].delta`, `responses.ts` for the `response.*` event orchestrator (`extractOpenAIResponseEvent`, re-exporting `drainResponseToolBuffer`), `responseToolCalls.ts` for Responses tool-call id resolution + argument buffering, `responseMetadata.ts` for usage extraction / completion handling / ignored-event + incomplete-reason constants, and `shared.ts` for small result helpers.
- `anthropic.ts` — reads `content_block_delta` text/thinking events, `tool_use` / `input_json_delta`, and `signature_delta` (surfaced as `metadata.thinkingSignature` so extended-thinking blocks can be replayed); treats `message_stop` as done.
- `gemini.ts` — public Gemini facade preserving the `src/connectors/gemini` import path. Internals are split under `connectors/gemini/`: `connector.ts` orchestrates parse flow, `state.ts` keeps first-seen-wins function-call ids, `candidates.ts` selects candidate index 0 and extracts parts, `toolDeltas.ts` maps `functionCall` parts, `unsupportedParts.ts` warns on `inlineData`/`fileData`, `promptFeedback.ts` handles prompt blocking, `finish.ts` handles STOP/MAX_TOKENS/blocked/unspecified finish reasons, and `result.ts` holds result append helpers.
- `geminiSemantics.ts` — Gemini finish-reason and safety-rating predicates/messages shared by Gemini parser modules.
- `aiSdk.ts` — public AI SDK facade. Internals are split under `connectors/aiSdk/`: `uiMessageStream.ts` for SSE-wrapped UI-message-stream JSON (`text-delta`, `reasoning-delta`, `tool-input-*`, `tool-output-available`, `finish` / `finish-message`, `{ type: 'error', errorText }`) plus the `AI_SDK_FRAME_TYPES` set and `isAiSdkFrameType`; `dataStream.ts` for the prefix-coded data-stream protocol (`0:`, `g:`, `9:`, `b:`, `c:`, `a:`, `3:`, plus the `d:` finish-message frame and the recognised-but-ignored `e:` finish-step frame) and `DATA_STREAM_PREFIX_PATTERN`; `shared.ts` for `AiSdkConnectorState`, `createAiSdkConnectorState`, `resetAiSdkState`, the `toolDeltaFrom*` helpers, and `warnMissingToolCallId`. Unknown frames return null instead of leaking protocol text. Data-stream lines must arrive through SSE — see the README recipe for the one-line server wrap.
- `error.ts` / `objectUtils.ts` — shared in-band error extraction and small object helpers.

OpenAI, Anthropic, and Gemini JSON connectors call `extractErrorMessage()` before provider-specific extraction. AI SDK and `autoConnector` first claim recognised AI SDK UI-message frames so `{ type: 'text-delta', error: 'stray' }` behaves the same through `connector="ai-sdk"` and `connector="auto"`. Error results preserve the original provider payload as `errorPayload`. To avoid misclassifying normal output, a bare top-level `error` *string* is only treated as terminal when the frame has no recognised streaming-event shape (`choices`, `candidates`, `delta`, `content_block`, or a non-`error` event `type`); structured `{ error: { message } }` objects and explicit `{ type: 'error' }` frames are always honoured.

## Auto detection

`auto.ts` exports `autoConnector`, which handles `[DONE]`, parses JSON, and dispatches in this order:

1. recognised AI SDK UI-message-stream `type` (including lifecycle frames and `data-*`) => AI SDK
2. in-band provider error => `{ error, errorPayload }`
3. `choices` array => OpenAI Chat Completions
4. `candidates` array => Gemini
5. `type` starting with `response.` => OpenAI Responses API
6. known Anthropic event `type` => Anthropic
7. generic JSON text fields (`text`, `content`, `delta`) => text
8. non-JSON data that conservatively matches a real AI SDK data-stream frame (`<prefix>:` with valid JSON, and object payloads for `d:` / `e:` finish frames) => AI SDK
9. otherwise non-empty data => OpenAI plain-text fallthrough so `<think>` traces still route to reasoning

Do not loosen the AI SDK data-stream guard: `connector="auto"` must render prose like `a: see below`, `d:0`, or `e:"note"` as visible plain text rather than dropping it or terminating the stream.

## Adding a provider

1. Implement `Connector` in a new file. If it needs parser memory, expose `createState()` and thread the state through helper functions.
2. Export it from `connectors.ts` and register its string name in `registry.ts` / `getConnector()`.
3. If exposing a string option, add the name once to centralized `ConnectorName` in `src/types.ts`; `ChorusProps` and `useChorusStream` import that alias.
4. Add shape detection to `connectors/auto/detection.ts` and dispatch in `connectors/auto/dispatch.ts` when safe and unambiguous, including `errorPayload` handling and a `flush()` hook if the parser buffers partial output.
5. Add connector tests for text, reasoning/tool deltas, done, warnings/metadata, in-band errors, EOF flushes, empty/invalid payloads, and auto-detection.
