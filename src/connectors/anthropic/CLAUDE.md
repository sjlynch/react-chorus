# anthropic connector guide

Internals behind the `anthropicConnector` singleton, re-exported from `../anthropic.ts` so the public `src/connectors/anthropic` import path is preserved. See `../CLAUDE.md` for the shared connector contract.

## Files

- `index.ts` — folder barrel; re-exports `anthropicConnector`, `createAnthropicConnectorState`, and the `AnthropicConnectorState` type.
- `connector.ts` — orchestrator: the `Connector` object whose `extract()` parses the SSE JSON, runs `extractErrorMessage`, then dispatches on `obj.type` (`message_stop`, `message_start`, `message_delta`, `content_block_start`, `content_block_delta`) to the per-event handlers below. `message_stop` resets state and signals `{ done: true }`; unknown event types return `null` silently per the parent guide's unknown-event policy. `flush()` also resets state on abnormal close.
- `state.ts` — per-stream parse state: `AnthropicConnectorState`'s two block-index → tool-id maps (`toolIdsByBlockIndex` for the canonical id we emit, `providerToolIdsByBlockIndex` for explicit provider ids), plus `createAnthropicConnectorState`, `resetAnthropicState`, `blockIndexKey`, and `fallbackToolId` (the `anthropic-tool-<index>` synthetic id used when the provider omits one).
- `messageStart.ts` — `handleMessageStart`: surfaces `message.usage.input_tokens` as `metadata.usage` so prompt-token cost telemetry is not dropped.
- `messageDelta.ts` — `handleMessageDelta`: builds the terminal stop-reason result. Bare `message_delta` frames (no `stop_reason`) still surface cumulative `usage.output_tokens` as `metadata.usage`. `stop_reason === 'refusal'` becomes a connector error with metadata; `stop_reason === 'max_tokens'` becomes a `truncated` warning; other reasons (`end_turn`, `stop_sequence`, `tool_use`) surface as `metadata.stopReason` (plus `metadata.stopSequence` when present).
- `contentBlockStart.ts` — `handleContentBlockStart`: dispatches on `block.type` for `thinking` (seed reasoning), `tool_use` (record the id under the block index and emit a tool delta, generating a fallback id when the provider omits one), `web_search_tool_result` (map web-search grounding entries to `MessageSource`s), and a `text` block with seeded `citations` (rare on streams, valid on replay).
- `contentBlockDelta.ts` — `handleContentBlockDelta`: dispatches on `delta.type` for `text_delta`, `thinking_delta`, `signature_delta` (extended-thinking signature → `metadata.thinkingSignature` so replays don't 400), `citations_delta` (one citation → `MessageSource`), and `input_json_delta` (tool argument fragments, resolving the tool id through the state map and the provider-id vs generated flag).
- `citations.ts` — `collectAnthropicCitations` (maps a list of citation entries to `MessageSource[]` via `../sourceMapping`) and `sourcesResult` (picks `source` vs `sources` based on count so `useChorusStream` appends each entry instead of dropping array elements).

## Parse flow

Raw Anthropic SSE chunk → `connector.extract()` parses the JSON, runs `extractErrorMessage`, then dispatches on `obj.type` → one of the `handle*` modules returns a `ConnectorResult` (or `null`). The per-event handlers are independent and individually testable; the only cross-handler state is the block-index → tool-id maps in `state.ts`, written by `handleContentBlockStart` (tool_use) and read by `handleContentBlockDelta` (input_json_delta), cleared on `message_stop` and `flush()`.
