# openai connector guide

Internals behind the `openaiConnector` singleton and `createOpenAIConnector` factory, re-exported from `../openai.ts` so the public `src/connectors/openai` import path is preserved. See `../CLAUDE.md` for the shared connector contract.

## Two OpenAI streaming APIs, one connector

OpenAI ships **two completely different streaming protocols**, and this connector parses both off the same SSE stream:

- **Chat Completions** — chunks shaped `{ choices: [{ delta }] }`. Owned by `chatCompletions.ts`.
- **Responses API** — typed `response.*` events (`response.output_text.delta`, `response.completed`, …). Owned by `responses.ts` and the `response*Events.ts` handlers.

`../openai.ts` routes per chunk: an event whose `type` starts with `response.` goes to the Responses path, an `Array.isArray(choices)` chunk goes to Chat Completions. Keep the two paths separate — they share only `shared.ts` helpers and `thinkTagSplitter.ts`.

## Files

- `chatCompletions.ts` — Chat Completions parser (`choices[].delta` text/reasoning/tool_calls, `finish_reason`, usage).
- `responses.ts` — thin dispatcher for the Responses API: the `RESPONSE_EVENT_HANDLERS` table maps each `response.*` type to one handler, and re-exports `drainResponseToolBuffer`/`drainResponseRefusalText`.
- `responseTerminalEvents.ts` — terminal `response.completed` / `response.incomplete` handler (flush, drain buffers, completion metadata).
- `responseErrorEvents.ts` — `response.failed` / `response.error` handler → `{ error, errorPayload }`.
- `responseRefusalEvents.ts` — `response.refusal.added` / `.delta` / `.done` lifecycle handler.
- `responseTextEvents.ts` — `response.output_text.delta` + the `response.reasoning_*` delta handler.
- `responseSourceEvents.ts` — `response.output_text.annotation.added` / `.done` source/citation extraction.
- `responseToolEvents.ts` — `response.output_item.added` / `.done` + `response.function_call_arguments.delta` handler.
- `responseMetadata.ts` — Responses completion/usage/finish-reason handling plus `IGNORED_RESPONSE_EVENT_TYPES`.
- `responseToolCalls.ts` — Responses tool-call id aliasing and argument buffering/replay primitives used by `responseToolEvents.ts` and `responseTerminalEvents.ts`.
- `shared.ts` — result-merge helpers shared by both parsers.
- `thinkTagSplitter.ts` — stateful `<think>`-tag splitter supporting custom reasoning tag pairs for proxy compatibility.

## Gotchas

- **Responses tool-call ids resolve late.** A `function_call_arguments.delta` can arrive before the `output_item.added` that reveals the call id. Such deltas are buffered (`responseToolArgBuffer`) and replayed once `output_item.added` registers the resolved identity in `responseToolAliases`, so a late id never splits one call into two rendered tool blocks.
- **`output_item.done` must NOT re-seed tool `input`.** It carries the COMPLETE accumulated `arguments` string, but the `function_call_arguments.delta` events already streamed every fragment; only `.added` seeds `input`, `.done` just confirms id/name.
- **Per-chunk cumulative `usage` is emitted exactly once.** Some OpenAI-compatible proxies attach a cumulative `usage` object to every chunk; it is buffered and surfaced once on the terminating chunk (`finish_reason`, trailing empty `choices`, or `flush()`), so a non-idempotent `onMetadata` consumer can't over-count.
- **Custom reasoning tags.** The `thinkTag` connector option lets proxies use alternate reasoning delimiters (`<Think>`, `<reasoning>…</reasoning>`); tags are compiled once into `state.thinkTags` and reused across chunks.
