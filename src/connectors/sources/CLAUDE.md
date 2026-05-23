# sources guide

Per-provider source/citation mappers that turn raw provider payloads into the shared `MessageSource` shape. Each file targets one provider so an LLM can locate a mapper by filename instead of scrolling a single union module.

## Module map

- `shared.ts` — private helpers (`isRecord`, `stringFrom`, `numberFrom`, `recordFrom`, `withDefinedMetadata`, `normalizeSourceType`, `sourceHasRenderableData`, `buildSource`) used by every provider mapper. Keep new shared logic here.
- `aiSdk.ts` — Vercel AI SDK UI-message-stream frames and data-stream payloads: `sourceFromAiSdkUiFrame`, `sourceFromAiSdkDataStream`, `extractSourcesFromUnknown`, `sourcesFromAiSdkMetadataFrame`.
- `openai.ts` — OpenAI Responses API output-text annotations: `sourceFromOpenAIResponseAnnotation`, `sourcesFromOpenAIResponseEvent`.
- `anthropic.ts` — Anthropic Messages API citations on text content blocks and `web_search_tool_result` hits: `sourceFromAnthropicCitation`, `sourcesFromAnthropicWebSearchToolResult`.
- `gemini.ts` — Gemini grounding/citation metadata on candidates: `sourcesFromGeminiGroundingMetadata`, `sourcesFromGeminiCitationMetadata`.

`../sourceMapping.ts` re-exports every public symbol from this folder so existing internal imports (`connectors/anthropic.ts`, `connectors/openai/responseSourceEvents.ts`, `connectors/gemini/*`, `connectors/aiSdk/*`) keep resolving. Don't rename or remove exported symbols — public API stability matters.
