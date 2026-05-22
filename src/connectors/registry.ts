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

function isKnownConnectorName(name: string): name is ConnectorName {
  return (VALID_CONNECTOR_NAMES as readonly string[]).includes(name);
}

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
  // Word the built-in and custom cases differently: a built-in connector other
  // than `openai` genuinely does not consume options, whereas a custom
  // connector object is not the limiting factor — the library simply has no
  // mechanism to forward connector options to a custom connector.
  const reason = typeof connector === 'string'
    ? `the \`${connector}\` connector does not accept them`
    : connector
      ? 'Chorus has no mechanism to forward connector options to a custom connector object'
      : 'the default `auto` connector does not accept them';
  console.warn(`[Chorus] getConnector() received connector options, but ${reason}. Connector options currently only apply to \`getConnector('openai', ...)\` (or \`connector="openai"\` with \`connectorOptions\`).`);
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
  // For an unknown string name, leave the diagnostics to the dedicated "Unknown
  // connector" warning below — it already explains the `auto` fallback. Emitting
  // the generic ignored-options warning too would say "the `opena` connector
  // does not accept them", implying a real connector named after the typo and
  // contradicting the fallback message. Known non-openai names, custom connector
  // objects, and the default `auto` connector still get the ignored-options warning.
  if (options && connector !== 'openai' && (typeof connector !== 'string' || isKnownConnectorName(connector))) {
    warnIgnoredConnectorOptions(connector);
  }
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
