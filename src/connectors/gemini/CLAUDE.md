# gemini connector guide

Internals behind the `geminiConnector` singleton, re-exported from `../gemini.ts` so the public `src/connectors/gemini` import path is preserved. See `../CLAUDE.md` for the shared connector contract and `../geminiSemantics.ts` for the finish-reason / safety-rating predicates these modules share.

## Files

- `index.ts` — folder barrel; re-exports `geminiConnector`, `createGeminiConnectorState`, and the `GeminiConnectorState` type.
- `connector.ts` — orchestrator: the `Connector` object whose `extract()` runs the parse flow below.
- `candidates.ts` — selects candidate index 0 (`selectedCandidate`/`getCandidateKey`) and extracts its `content.parts[*]` text/reasoning/tool/unsupported parts.
- `toolDeltas.ts` — maps a `functionCall` part to a `ConnectorToolDelta`, resolving its id via state.
- `finish.ts` — maps `finishReason`: STOP/MAX_TOKENS finish the stream (MAX_TOKENS also warns `truncated`), blocked/unspecified reasons become connector errors.
- `promptFeedback.ts` — handles `promptFeedback` prompt-level blocking (request rejected before any candidate) as an error with safety metadata.
- `state.ts` — per-stream parse state: first-seen-wins function-call id map (`createGeminiConnectorState`, `resolveFunctionCallId`).
- `unsupportedParts.ts` — detects `inlineData`/`fileData` parts the connector cannot render, so they surface as an `unsupported-part` warning instead of being dropped.
- `result.ts` — `ConnectorResult` append helpers (`appendField`, `appendToolDelta`, `addWarning`, `hasToolDelta`).

## Parse flow

Raw Gemini SSE chunk -> `connector.extract()` parses the JSON, classifies prompt-feedback blocking and in-band errors, then selects candidate 0 -> `candidates.ts` walks its parts (delegating to `toolDeltas.ts` and `unsupportedParts.ts`) -> `finish.ts` applies the `finishReason` -> a `ConnectorResult` is returned (built up through `result.ts` helpers), or `null` when the chunk yields nothing.
