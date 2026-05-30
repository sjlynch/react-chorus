import React from 'react';
import type { ConnectorName } from '../types';
import type { Transport } from '../hooks/useChorusStream';
import type { FetchTransportInit } from '../hooks/assistant-session/transport';
import type { ChatInputModelPicker, ChatInputSlashCommand } from '../components/chat-input/types';
import { isChorusDevMode } from '../utils/devMode';

// Dedupe console.warn calls across re-mounts so a single buggy `defaultProvider`
// prop or a single discarded active provider only spams once per key, mirroring
// the `warnedUnknownConnectorNames` pattern in `src/connectors/registry.ts`.
const warnedUnknownDefaultProviders = new Set<string>();
const warnedDiscardedActiveProviders = new Set<string>();

function warnUnknownDefaultProvider(
  providers: Record<string, unknown>,
  defaultProvider: string,
  picked: string | undefined,
): void {
  if (!isChorusDevMode()) return;
  if (warnedUnknownDefaultProviders.has(defaultProvider)) return;
  warnedUnknownDefaultProviders.add(defaultProvider);
  const validKeys = Object.keys(providers).join(', ');
  console.warn(
    `[Chorus] Unknown defaultProvider \`${defaultProvider}\`; falling back to \`${picked}\`. Valid providers: ${validKeys}.`,
  );
}

function warnDiscardedActiveProvider(
  providers: Record<string, unknown>,
  discarded: string,
  picked: string | undefined,
): void {
  if (!isChorusDevMode()) return;
  if (warnedDiscardedActiveProviders.has(discarded)) return;
  warnedDiscardedActiveProviders.add(discarded);
  const validKeys = Object.keys(providers).join(', ');
  console.warn(
    `[Chorus] Active provider \`${discarded}\` is no longer in the providers map; falling back to \`${picked}\`. Valid providers: ${validKeys}.`,
  );
}

/**
 * One entry in the `<Chorus providers>` registry. Pairs a transport (URL,
 * `FetchTransportInit`, or a custom `Transport` function) with the connector
 * that parses its SSE frames; the optional `label` is used by the composer
 * model picker and the optional `modelId` is tagged onto assistant messages
 * routed through this provider for the cost meter / pricing lookups.
 */
export interface ChorusProviderConfig<TMeta = Record<string, unknown>> {
  transport: string | FetchTransportInit<TMeta> | Transport<TMeta>;
  connector?: ConnectorName;
  label?: string;
  modelId?: string;
}

/**
 * Prefix recognized by the `/model:<id>` slash command. The composer's slash
 * palette filters commands by `startsWith`, so each provider is registered as
 * an exact-match command rather than parsing free-form arguments.
 */
export const MODEL_SLASH_COMMAND_PREFIX = '/model:';

export interface MultiProviderRuntime<TMeta> {
  activeProvider: string | undefined;
  setActiveProvider: (next: string | undefined) => void;
  effectiveTransport: ChorusProviderConfig<TMeta>['transport'] | undefined;
  effectiveConnector: ConnectorName | undefined;
  effectiveModelId: string | undefined;
  modelPicker: ChatInputModelPicker | undefined;
  slashCommands: ChatInputSlashCommand[];
  /**
   * Returns true when the command name was a recognized `/model:<id>` switch
   * and the active provider was updated; false otherwise so the caller can
   * fall through to its own slash-command handler (e.g. MCP prompts).
   */
  handleSlashCommand: (commandName: string) => boolean;
  /**
   * Build the `{ provider, modelId }` defaults attached to new assistant
   * messages while a provider is active. Returns an empty object when
   * multi-provider routing is not configured so existing message shapes are
   * unchanged on the single-provider path.
   */
  getAssistantMessageDefaults: () => { provider?: string; modelId?: string };
}

interface UseMultiProviderRuntimeArgs<TMeta> {
  providers: Record<string, ChorusProviderConfig<TMeta>> | undefined;
  defaultProvider: string | undefined;
  fallbackTransport: ChorusProviderConfig<TMeta>['transport'] | undefined;
  fallbackConnector: ConnectorName | undefined;
  fallbackModelId: string | undefined;
}

function pickInitialActiveProvider<TMeta>(
  providers: Record<string, ChorusProviderConfig<TMeta>> | undefined,
  defaultProvider: string | undefined,
): string | undefined {
  if (!providers) return undefined;
  if (defaultProvider && Object.prototype.hasOwnProperty.call(providers, defaultProvider)) {
    return defaultProvider;
  }
  const firstKey = Object.keys(providers)[0];
  return firstKey;
}

/**
 * Multi-provider routing state for `<Chorus providers>`. Owns the
 * `activeProvider` selection (defaulting to `defaultProvider` or the first
 * provider in the registry), resolves the effective transport / connector /
 * model id for the next turn, and builds the composer model-picker view plus
 * the `/model:<id>` slash-command set.
 */
export function useMultiProviderRuntime<TMeta>({
  providers,
  defaultProvider,
  fallbackTransport,
  fallbackConnector,
  fallbackModelId,
}: UseMultiProviderRuntimeArgs<TMeta>): MultiProviderRuntime<TMeta> {
  const hasProviders = Boolean(providers && Object.keys(providers).length > 0);
  const [activeProvider, setActiveProvider] = React.useState<string | undefined>(() => {
    const picked = pickInitialActiveProvider(providers, defaultProvider);
    if (
      providers
      && Object.keys(providers).length > 0
      && defaultProvider
      && !Object.prototype.hasOwnProperty.call(providers, defaultProvider)
    ) {
      warnUnknownDefaultProvider(providers, defaultProvider, picked);
    }
    return picked;
  });

  // Keep the active provider valid if the providers map changes underneath us
  // — e.g. a host swapping which providers are configured at runtime. We only
  // adjust when the current selection no longer exists; an in-bounds value is
  // preserved across re-renders.
  React.useEffect(() => {
    if (!providers) {
      if (activeProvider !== undefined) setActiveProvider(undefined);
      return;
    }
    if (activeProvider && Object.prototype.hasOwnProperty.call(providers, activeProvider)) return;
    const picked = pickInitialActiveProvider(providers, defaultProvider);
    if (activeProvider && Object.keys(providers).length > 0) {
      warnDiscardedActiveProvider(providers, activeProvider, picked);
    }
    setActiveProvider(picked);
  }, [providers, defaultProvider, activeProvider]);

  const activeConfig = hasProviders && activeProvider && providers
    ? providers[activeProvider]
    : undefined;

  const effectiveTransport = activeConfig?.transport ?? fallbackTransport;
  const effectiveConnector = activeConfig?.connector ?? fallbackConnector;
  const effectiveModelId = activeConfig?.modelId ?? fallbackModelId;

  const modelPicker = React.useMemo<ChatInputModelPicker | undefined>(() => {
    if (!hasProviders || !providers) return undefined;
    const options = Object.entries(providers).map(([value, config]) => ({
      value,
      label: config.label ?? value,
    }));
    return {
      options,
      value: activeProvider ?? options[0]?.value ?? '',
      onChange: (next: string) => setActiveProvider(next),
    };
  }, [hasProviders, providers, activeProvider]);

  const slashCommands = React.useMemo<ChatInputSlashCommand[]>(() => {
    if (!hasProviders || !providers) return [];
    return Object.entries(providers).map(([value, config]) => ({
      name: `${MODEL_SLASH_COMMAND_PREFIX}${value}`,
      description: config.label ? `Route the next turn to ${config.label}` : `Route the next turn to ${value}`,
    }));
  }, [hasProviders, providers]);

  const handleSlashCommand = React.useCallback((commandName: string): boolean => {
    if (!commandName.startsWith(MODEL_SLASH_COMMAND_PREFIX)) return false;
    const id = commandName.slice(MODEL_SLASH_COMMAND_PREFIX.length);
    if (!providers || !Object.prototype.hasOwnProperty.call(providers, id)) return false;
    setActiveProvider(id);
    return true;
  }, [providers]);

  const activeProviderRef = React.useRef(activeProvider);
  activeProviderRef.current = activeProvider;
  const activeModelIdRef = React.useRef(effectiveModelId);
  activeModelIdRef.current = effectiveModelId;

  const getAssistantMessageDefaults = React.useCallback((): { provider?: string; modelId?: string } => {
    if (!hasProviders) {
      // Without a providers registry we still tag modelId if the host passed
      // a conversation-level `modelId` prop; that keeps the cost-meter
      // pricing lookup working off `message.modelId` for single-provider
      // setups that previously relied on the metadata-only path.
      if (fallbackModelId) return { modelId: fallbackModelId };
      return {};
    }
    const out: { provider?: string; modelId?: string } = {};
    if (activeProviderRef.current) out.provider = activeProviderRef.current;
    if (activeModelIdRef.current) out.modelId = activeModelIdRef.current;
    return out;
  }, [hasProviders, fallbackModelId]);

  return {
    activeProvider,
    setActiveProvider,
    effectiveTransport,
    effectiveConnector,
    effectiveModelId,
    modelPicker,
    slashCommands,
    handleSlashCommand,
    getAssistantMessageDefaults,
  };
}
