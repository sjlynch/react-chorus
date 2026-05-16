# Provider request mappers

Provider-specific request-body mapping lives in this folder:

- `openai.ts` — Chat Completions and Responses message/input serialization.
- `anthropic.ts` — Messages API system/message/tool-use serialization.
- `gemini.ts` — GenerateContent contents, multimodal parts, and functionCall/functionResponse history.
- `attachments.ts`, `metadata.ts`, `toolOutput.ts`, and `options.ts` — shared helpers for attachment fallbacks, provider metadata aliases, tool output rendering, and option stripping.

Keep `src/providerRequests.ts` as the public compatibility facade. When adding a provider, put provider-only rules in a new module here, reuse the shared helpers where possible, and export public names through the facade without changing existing request helper names or body shapes.
