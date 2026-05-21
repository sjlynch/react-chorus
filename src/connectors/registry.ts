import type { ConnectorName } from '../types';
import { anthropicConnector } from './anthropic';
import { aiSdkConnector } from './aiSdk';
import { autoConnector } from './auto';
import { geminiConnector } from './gemini';
import { createOpenAIConnector, openaiConnector, type OpenAIConnectorOptions } from './openai';
import type { Connector } from './types';

const VALID_CONNECTOR_NAMES = ['auto', 'openai', 'anthropic', 'gemini', 'ai-sdk'] as const;
const warnedUnknownConnectorNames = new Set<string>();
const warnedIgnoredOptionsConnectors = new Set<string>();

function isConnectorDevMode() {
  // Local to keep connector-only chunks independent from widget dev helpers.
  try {
    return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

/**
 * Warn (once per connector) when `getConnector` is handed options it cannot
 * apply. Only the `'openai'` string connector consumes the `options` argument;
 * for every other connector the argument is silently dropped, which is the
 * exact "dead option" footgun this guard surfaces in development.
 */
function warnIgnoredConnectorOptions(connector: Connector | ConnectorName | undefined) {
  if (!isConnectorDevMode()) return;
  const key = typeof connector === 'string' ? connector : connector ? `object:${connector.name}` : 'auto';
  if (warnedIgnoredOptionsConnectors.has(key)) return;
  warnedIgnoredOptionsConnectors.add(key);
  const target = typeof connector === 'string'
    ? `the \`${connector}\` connector`
    : connector
      ? 'a custom connector object'
      : 'the default `auto` connector';
  console.warn(`[Chorus] getConnector() received connector options, but ${target} does not accept them. Connector options currently only apply to \`getConnector('openai', ...)\` (or \`connector="openai"\` with \`connectorOptions\`).`);
}

/**
 * Resolve a connector. This is the single public way to obtain a built-in
 * connector: pass a name (`'auto'` | `'openai'` | `'anthropic'` | `'gemini'` |
 * `'ai-sdk'`) and Chorus returns the matching connector; pass a custom
 * `Connector` object and it is returned unchanged; pass nothing for the
 * auto-detecting connector.
 *
 * `options` customizes the resolved connector and is currently consumed only by
 * the `'openai'` connector (e.g. a custom `thinkTag` delimiter pair). It is
 * ignored — with a dev-mode warning — for every other connector.
 */
export function getConnector(connector?: Connector | ConnectorName, options?: OpenAIConnectorOptions): Connector {
  if (options && connector !== 'openai') warnIgnoredConnectorOptions(connector);
  if (!connector) return autoConnector;
  if (typeof connector === 'string') {
    if (connector === 'auto') return autoConnector;
    if (connector === 'openai') return options ? createOpenAIConnector(options) : openaiConnector;
    if (connector === 'anthropic') return anthropicConnector;
    if (connector === 'gemini') return geminiConnector;
    if (connector === 'ai-sdk') return aiSdkConnector;

    if (isConnectorDevMode() && !warnedUnknownConnectorNames.has(connector)) {
      warnedUnknownConnectorNames.add(connector);
      console.warn(`[Chorus] Unknown connector \`${connector}\`; falling back to \`auto\`. Valid connector names: ${VALID_CONNECTOR_NAMES.join(', ')}.`);
    }

    return autoConnector;
  }
  return connector;
}
