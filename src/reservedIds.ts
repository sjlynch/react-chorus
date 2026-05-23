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
 * Reserved tool-call name the assistant emits to render a registered React
 * block inline (Generative UI). Double-underscore prefix keeps it from
 * colliding with real provider tools. Tool deltas with this name are mapped
 * into a message-level `block` field (see `Message.block`) instead of
 * producing a normal `role: 'tool'` row.
 */
export const RESERVED_BLOCK_TOOL_NAME = '__render_block';
