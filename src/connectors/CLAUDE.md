# connectors guide

Connectors parse provider-specific SSE `data:` chunks into shared streaming events for the pipeline.

## Contract

The parsing contract is:

```ts
(chunk: string, state?: unknown) => {
  text?: string;
  reasoning?: string;
  source?: MessageSource;
  sources?: MessageSource[];
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

`text` appends output, `reasoning` appends the assistant thinking trace, `source`/`sources` append source/citation references to the active assistant message, `toolDelta`/`toolDeltas` update one or more streamed tool-call messages, `done` stops the SSE reader, `error` carries an in-band provider error, `warning`/`warnings` carry non-fatal diagnostics (for example truncation or unsupported Gemini parts — use `warnings` when one chunk produces more than one, `warning` mirrors the first for back-compat), and `metadata` carries provider diagnostics such as safety ratings or response ids. When present, `errorPayload` is attached to the thrown `ChorusStreamError` so `onError`/`streamRawError` can inspect the provider JSON.

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
- `openai.ts` — public OpenAI facade and state factory. Internals are split under `connectors/openai/`: `thinkTagSplitter.ts` for `<think>` parsing + EOF flush, `chatCompletions.ts` for `choices[].delta`, `responses.ts` for the `response.*` event orchestrator (`extractOpenAIResponseEvent`, re-exporting `drainResponseToolBuffer`), `responseSourceEvents.ts` for Responses output-text annotations, `responseToolCalls.ts` for Responses tool-call id resolution + argument buffering, `responseMetadata.ts` for terminal-completion handling (token usage via the shared `usage.ts`, incomplete-reason warnings) + ignored-event constants, and `shared.ts` for small result helpers.
- `anthropic.ts` — public Anthropic facade preserving the `src/connectors/anthropic` import path. Internals are split under `connectors/anthropic/`: `connector.ts` parses the SSE JSON, runs `extractErrorMessage`, and dispatches on `obj.type` to per-event handlers; `state.ts` owns the block-index → tool-id maps (`createAnthropicConnectorState`, `resetAnthropicState`, `blockIndexKey`, `fallbackToolId`); `messageStart.ts` surfaces prompt-token usage; `messageDelta.ts` builds the terminal stop-reason/usage/refusal/max-tokens result; `contentBlockStart.ts` dispatches on `block.type` (`thinking`, `tool_use`, `web_search_tool_result`, seeded-`citations` text blocks); `contentBlockDelta.ts` dispatches on `delta.type` (`text_delta`, `thinking_delta`, `signature_delta` → `metadata.thinkingSignature`, `citations_delta`, `input_json_delta`); `citations.ts` holds `collectAnthropicCitations` and the `sourcesResult` single-vs-many slot helper. `message_stop` (and `flush()`) reset state and signal done.
- `gemini.ts` — public Gemini facade preserving the `src/connectors/gemini` import path. Internals are split under `connectors/gemini/`: `connector.ts` orchestrates parse flow, `state.ts` keeps first-seen-wins function-call ids, `candidates.ts` selects candidate index 0 and extracts parts, `toolDeltas.ts` maps `functionCall` parts, `unsupportedParts.ts` warns on unrenderable parts (`inlineData`/`fileData`, `executableCode`/`codeExecutionResult`), `promptFeedback.ts` handles prompt blocking, `finish.ts` handles STOP/MAX_TOKENS/blocked/unspecified finish reasons, and `result.ts` holds result append helpers.
- `geminiSemantics.ts` — Gemini finish-reason and safety-rating predicates/messages shared by Gemini parser modules.
- `aiSdk.ts` — public AI SDK facade. Internals are split under `connectors/aiSdk/`: `uiMessageStream.ts` for SSE-wrapped UI-message-stream JSON (`text-delta`, `reasoning-delta`, `source-url`, `source-document`, `message-metadata`, `tool-input-*`, `tool-output-available`, `finish` / `finish-message`, `{ type: 'error', errorText }`) plus the `AI_SDK_FRAME_TYPES` set and `isAiSdkFrameType`; `dataStream.ts` for the prefix-coded data-stream protocol (`0:`, `g:`, `j:` sources, source-like `7:`/`8:` annotations, `9:`, `b:`, `c:`, `a:`, `3:`, plus the `d:` finish-message frame and the recognised-but-ignored `e:` finish-step frame) and `DATA_STREAM_PREFIX_PATTERN`; `shared.ts` for `AiSdkConnectorState`, `createAiSdkConnectorState`, `resetAiSdkState`, the `toolDeltaFrom*` helpers, `warnMissingToolCallId`, and `aiSdkFinishResult` (builds the terminal `{ done: true }` result, surfacing `metadata.usage`/`finishReason` from a `finish`/`finish-message`/`d:` frame via the shared `extractUsage`). Unknown frames return null instead of leaking protocol text. Data-stream lines must arrive through SSE — see the README recipe for the one-line server wrap.
- `error.ts` / `objectUtils.ts` — shared in-band error extraction and small object helpers.
- `usage.ts` — shared `extractUsage` token-usage normalizer: collapses each provider's `usage` / `usageMetadata` field names into the `{ promptTokens, completionTokens, totalTokens }` shape for `ConnectorResult.metadata.usage`.
- `sourceMapping.ts` — re-export barrel kept for stable internal import paths; the per-provider source/citation mappers live under `connectors/sources/` (`shared.ts` + `aiSdk.ts` / `openai.ts` / `anthropic.ts` / `gemini.ts`). See `connectors/sources/CLAUDE.md`.

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

## Unknown-event policy

Each connector handles a closed set of provider events; an event outside that set is normally dropped. To stop silent regressions when an upstream rolls out a new event, the connectors apply different forward-compat policies depending on how their dispatch is structured:

- **OpenAI Responses** (`openai/responses.ts`) — fires `warnOnceInDev('openai-responses-unknown-event:<type>', ...)` and surfaces a non-fatal `ConnectorWarning` (`code: 'unknown-event'`) when `type` is non-empty, not in `IGNORED_RESPONSE_EVENT_TYPES`, and not in `RESPONSE_EVENT_HANDLERS`. The Responses API still adds new `response.*` event groups (e.g. `response.web_search_call.*`, `response.code_interpreter_call.*`), so an exhaustive dispatch table needs an explicit signal when reality outgrows it.
- **OpenAI Chat Completions** — dispatches on shape (`choices[].delta`), not `type`, so there is no closed event-name set to validate against. Forward-compat hygiene lives in the field-level extractors (e.g. reasoning-field priority, tool-call index fallback).
- **Anthropic Messages** (`anthropic/connector.ts`) — uses an explicit `switch` on `obj.type` that delegates to one handler per event. New Anthropic event types are rare and the connector is not the dispatch hot-spot, so unknown types still return `null` silently from the default branch; revisit if the Messages API begins to add events at the cadence of Responses.
- **AI SDK** (`aiSdk/uiMessageStream.ts`) — `AI_SDK_FRAME_TYPES` already enumerates every UI-message-stream frame the connector parses or intentionally ignores; `autoConnector` only delegates frames matching `isAiSdkFrameType()` to this path, so an unrecognised `type` reaching `uiMessageStreamResult` would only come from direct (non-auto) usage with a malformed frame. Returning `null` is correct rather than warning, because the same set is shared with `autoConnector`'s claim guard and a warning here would fire for every legitimate non-AI-SDK frame routed through `connector="auto"`.
- **Gemini** (`gemini/connector.ts`) — dispatches on `candidates`/`promptFeedback` shape, not on a `type` field, so it has no closed event-name set to compare against. Unknown `parts[]` kinds are already warned through `unsupportedParts.ts`, which is the field-level analogue of the Responses warning.

When adding a new event type to the OpenAI Responses connector, either register a handler in `RESPONSE_EVENT_HANDLERS` or add it to `IGNORED_RESPONSE_EVENT_TYPES` — the dev warning is the prompt to choose one explicitly.

## Adding a provider

1. Implement `Connector` in a new file. If it needs parser memory, expose `createState()` and thread the state through helper functions.
2. Export it from `connectors.ts` and register its string name in `registry.ts` / `getConnector()`.
3. If exposing a string option, add the name once to centralized `ConnectorName` in `src/types.ts`; `ChorusProps` and `useChorusStream` import that alias.
4. Add shape detection to `connectors/auto/detection.ts` and dispatch in `connectors/auto/dispatch.ts` when safe and unambiguous, including `errorPayload` handling and a `flush()` hook if the parser buffers partial output.
5. Add connector tests for text, reasoning/source/tool deltas, done, warnings/metadata, in-band errors, EOF flushes, empty/invalid payloads, and auto-detection.
