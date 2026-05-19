# Provider request mappers

Provider-specific request-body mapping lives in this folder:

- `openai.ts` — thin facade re-exporting the public Chat Completions and Responses helpers from `openai/`.
- `openai/chatCompletions.ts` — Chat Completions message serialization (`toOpenAIChatCompletionsMessages`, `toOpenAIChatCompletionsBody`, `formatOpenAIChatCompletionsBody`).
- `openai/responses.ts` — Responses API input serialization (`toOpenAIResponsesInput`, `toOpenAIResponsesBody`, `formatOpenAIResponsesBody`).
- `openai/shared.ts` — small cross-cut helpers (e.g. `openAIToolCallId`) reused by both paths.
- `anthropic.ts` — Messages API system/message/tool-use serialization.
- `gemini.ts` — GenerateContent contents, multimodal parts, and functionCall/functionResponse history.
- `attachments.ts`, `metadata.ts`, `toolOutput.ts`, and `options.ts` — shared helpers for attachment fallbacks, provider metadata aliases, tool output rendering, and option stripping.
- `toolRunIterator.ts` — `forEachHistoryEntry(history, { onMessage, onToolRun })` folds contiguous runs of `role === 'tool'` messages into a single callback. It is the inner iterator used by `toolRunMapper.ts`; mappers do not call it directly.
- `toolRunMapper.ts` — `mapHistoryWithToolRuns(history, spec)` is the shared partition/append/fallback walk that every provider mapper performs over a tool run. The `spec` plugs in provider-specific behaviour: `mapMessage` for non-tool entries, `extractToolBlock` to pull the provider-typed block from a tool message, `emitToolGroup` to append a group of `(message, block)` pairs (the assistant tool_use / tool_call / function_call + the paired tool_result / tool / function_call_output), and `fallback` for tool messages the provider does not claim. `groupMode: 'all'` aggregates every typed message in a run before fallbacks (used by `anthropic.ts` and `openai/chatCompletions.ts`); `groupMode: 'contiguous'` aggregates contiguous typed sub-runs in original order (used by `gemini.ts` and `openai/responses.ts`). Add a new provider by writing a new `spec` instead of repeating the walk.
- `types.ts` — thin public type facade; keep existing exported type names re-exported here.
- `types/common.ts` — shared mapping/tool option types and body utility helpers.
- `types/openaiChat.ts`, `types/openaiResponses.ts`, `types/anthropic.ts`, and `types/gemini.ts` — provider-specific body options and wire-shape interfaces.

Keep `src/providerRequests.ts` as the public compatibility facade. When adding a provider, put provider-only rules in a new module here, reuse the shared helpers where possible, and export public names through the facade without changing existing request helper names, body shapes, or type names.
