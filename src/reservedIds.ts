/**
 * Reserved message ids that Chorus injects into transport request history.
 *
 * Kept in this dependency-free leaf module so the public barrels
 * (`react-chorus`, `react-chorus/server`, `react-chorus/provider-requests`) can
 * re-export the value without pulling in the `chorus-session` hook chunk.
 */

/**
 * Reserved message id for the synthetic `system` message that Chorus prepends
 * to transport request history from the `<Chorus systemPrompt>` prop.
 *
 * On the transport send path, when `systemPrompt` is set Chorus inserts
 * `{ id: RESERVED_SYSTEM_PROMPT_ID, role: 'system', text: systemPrompt }` as the
 * leading entry of `history` before the transport's `formatBody` runs.
 *
 * This id is reserved by Chorus: a host-authored message must not use it, or
 * the two will collide. The value is intentionally stable (not per-request) so
 * request mappers and tests can recognize the Chorus-injected system message;
 * connectors / request mappers / SSE proxies that need to distinguish it from a
 * host-authored `system` message should match on this id. Import the constant
 * from `react-chorus`, `react-chorus/server`, or `react-chorus/provider-requests`
 * instead of hard-coding the literal so mapper/proxy code does not break
 * silently if the value ever changes.
 */
export const RESERVED_SYSTEM_PROMPT_ID = 'chorus-system-prompt';

/**
 * Reserved tool name for assistant-emitted artifacts (long generated code,
 * documents, HTML, or React UI) that should render in the side panel instead
 * of inlining the full content in the transcript bubble.
 *
 * A `role: 'tool'` message whose `toolCall.name === ARTIFACT_TOOL_NAME` has
 * a `toolCall.input` of shape `{ id, kind, title, content, language? }` where
 * `kind` is one of `'code' | 'document' | 'html' | 'react'`. Chorus aggregates
 * these into the artifact registry, renders an inline `ArtifactCard` on the
 * transcript row, and exposes the content in `<ChorusArtifactPanel>`. Multiple
 * artifacts sharing the same `id` stack as versions of the same artifact.
 *
 * This name is reserved by Chorus: a host's executable tool must not register
 * a handler for it. Chorus does not invoke a handler for this tool — it
 * exists purely as the structured carrier for artifact payloads.
 */
export const ARTIFACT_TOOL_NAME = '__artifact';
