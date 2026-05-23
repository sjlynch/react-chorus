// Re-export barrel kept for internal imports. The per-provider source/citation
// mappers live in `./sources/` — see `./sources/CLAUDE.md`.
export {
  sourceFromAiSdkUiFrame,
  sourceFromAiSdkDataStream,
  extractSourcesFromUnknown,
  sourcesFromAiSdkMetadataFrame,
} from './sources/aiSdk';
export {
  sourceFromOpenAIResponseAnnotation,
  sourcesFromOpenAIResponseEvent,
} from './sources/openai';
export {
  sourceFromAnthropicCitation,
  sourcesFromAnthropicWebSearchToolResult,
} from './sources/anthropic';
export {
  sourcesFromGeminiGroundingMetadata,
  sourcesFromGeminiCitationMetadata,
} from './sources/gemini';
