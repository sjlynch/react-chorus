# Provider request mappers

Provider-specific request-body mapping lives in this folder:

- `openai.ts` — thin facade re-exporting the public Chat Completions and Responses helpers from `openai/`.
- `openai/chatCompletions.ts` — Chat Completions message serialization (`toOpenAIChatCompletionsMessages`, `toOpenAIChatCompletionsBody`, `formatOpenAIChatCompletionsBody`).
- `openai/responses.ts` — Responses API input serialization (`toOpenAIResponsesInput`, `toOpenAIResponsesBody`, `formatOpenAIResponsesBody`).
- `openai/shared.ts` — small cross-cut helpers (e.g. `openAIToolCallId`) reused by both paths.
- `aiSdk.ts` — Vercel AI SDK `ModelMessage[]` serialization for `streamText({ messages })`, including model content parts, tool-call/tool-result pairs, and generic AI SDK attachment parts.
- `anthropic.ts` — Messages API system/message/tool-use serialization.
- `gemini.ts` — GenerateContent contents, multimodal parts, and functionCall/functionResponse history.
- `attachments.ts`, `contentParts.ts`, `metadata.ts`, `toolOutput.ts`, and `options.ts` — shared helpers for attachment source resolution/fallbacks, provider text/user-attachment content-part mapping, provider metadata aliases, tool output rendering, option stripping, and provider system precedence.
- `toolRunIterator.ts` — `forEachHistoryEntry(history, { onMessage, onToolRun })` folds contiguous runs of `role === 'tool'` messages into a single callback. It is the inner iterator used by `toolRunMapper.ts`; mappers do not call it directly.
- `toolRunMapper.ts` — `mapHistoryWithToolRuns(history, spec)` is the shared partition/append/fallback walk that every provider mapper performs over a tool run. The `spec` plugs in provider-specific behaviour: `mapMessage` for non-tool entries, `extractToolBlock` to pull the provider-typed block from a tool message, `emitToolGroup` to append a group of `(message, block)` pairs (the assistant tool_use / tool_call / function_call + the paired tool_result / tool / function_call_output), and `fallback` for tool messages the provider does not claim. `groupMode: 'all'` aggregates every typed message in a run before fallbacks (used by `aiSdk.ts`, `anthropic.ts`, and `openai/chatCompletions.ts`); `groupMode: 'contiguous'` aggregates contiguous typed sub-runs in original order (used by `gemini.ts` and `openai/responses.ts`). Add a new provider by writing a new `spec` instead of repeating the walk.
- `types.ts` — thin public type facade; keep existing exported type names re-exported here.
- `types/common.ts` — shared mapping/tool option types and body utility helpers.
- `types/aiSdk.ts`, `types/openaiChat.ts`, `types/openaiResponses.ts`, `types/anthropic.ts`, and `types/gemini.ts` — provider-specific body options and wire-shape interfaces.

## Attachment mapping rules

- **User-turn attachments** are mapped to provider media parts (`image`/`document`/`input_image`/`input_file`/`inlineData`/`fileData`) by each mapper's `mapAttachment`. An attachment that cannot be represented in the provider schema (unsupported MIME, missing/invalid source URL) degrades to an unsupported-attachment text block.
- **Assistant-turn attachments** are *never* mapped to provider media parts: no provider accepts an image/file block in an assistant turn. `AssistantMessage` allows `attachments`, so a carried attachment is surfaced as the unsupported-attachment text block (an `output_text`/`text` part for OpenAI, joined into the assistant `content` string for Chat Completions) rather than being silently dropped.
- Every unsupported-attachment substitution emits a `warnOnceInDev` keyed by provider + attachment name, so the data loss is observable in development.
- `messageContentParts` (in `contentParts.ts`) centralizes this: it surfaces attachments for any role that carries them and only invokes `mapAttachment` for `role === 'user'`.
- OpenAI image attachments may carry a per-attachment fidelity hint at `attachment.metadata.openai.imageDetail` (`'auto' | 'low' | 'high'`), emitted as `image_url.detail` (Chat Completions) / `input_image.detail` (Responses).

## Tool source detection

`options.ts` decides whether a `tools` value is a Chorus definition array/registry (serialized via `to*Tools`) or a raw provider tool array (forwarded verbatim as the escape hatch). A Chorus array item is recognized by a `handler` function *or* a non-empty string `name` with none of the raw provider marker keys (`type`, `function`, `input_schema`, `functionDeclarations`) — so handler-less definition arrays are still serialized. A record registry is always Chorus-shaped (a record is never the raw escape hatch); its values may be handler functions or definition objects, handler-less ones included, and `toToolDefinitionList` keeps every non-function object entry with the record key as `name`. Raw Gemini tool arrays are forwarded unchanged but checked for empty `functionDeclarations` groups (an opaque-400 trap) with a dev warn.

Keep `src/providerRequests.ts` as the public compatibility facade. When adding a provider, put provider-only rules in a new module here, reuse the shared helpers where possible, and export public names through the facade without changing existing request helper names, body shapes, or type names.
