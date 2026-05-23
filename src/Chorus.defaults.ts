import type { OpenAIConnectorOptions } from './connectors/openai';
import type { Role } from './types';

export const DEFAULT_MIN_ASSISTANT_DELAY_MS = 300;
export const DEFAULT_PERSISTENCE_WRITE_DEBOUNCE_MS = 80;
export const DEFAULT_CHORUS_HIDDEN_ROLES: Role[] = ['system'];

/**
 * Type of the `connectorOptions` prop. Currently an alias for
 * `OpenAIConnectorOptions` because the `'openai'` connector is the only
 * built-in connector that consumes options today. It is declared as its own
 * named type so the underlying shape can later widen to a union (e.g. once
 * Gemini/Anthropic gain options) without changing the declared identity of
 * `ChorusProps['connectorOptions']` — honoring the "never break `ChorusProps`"
 * invariant.
 */
export type ChorusConnectorOptions = OpenAIConnectorOptions;
