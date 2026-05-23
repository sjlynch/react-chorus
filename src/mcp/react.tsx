import React from 'react';
import { createMcpRuntime } from './runtime';
import type { McpRuntime, McpRuntimeSnapshot, McpServerConfig } from './types';

const EMPTY_SNAPSHOT: McpRuntimeSnapshot = {
  servers: [],
  tools: [],
  toolRegistry: {},
  prompts: [],
  slashCommands: [],
  resources: [],
  resourceAttachments: [],
};

export interface ChorusMcpContextValue<TMeta = Record<string, unknown>> extends McpRuntimeSnapshot<TMeta> {
  reconnect: (serverName?: string) => void;
  applyPrompt: (commandName: string) => Promise<string>;
}

export interface ChorusMcpProviderProps<TMeta = Record<string, unknown>> {
  servers: McpServerConfig[];
  children: React.ReactNode;
  /** Optional observer for hosts that want to mirror the discovered registry elsewhere. */
  onChange?: (snapshot: McpRuntimeSnapshot<TMeta>) => void;
}

const ChorusMcpContext = React.createContext<ChorusMcpContextValue | null>(null);

export function useMcpRuntime<TMeta = Record<string, unknown>>(
  servers: McpServerConfig[] | undefined,
  onChange?: (snapshot: McpRuntimeSnapshot<TMeta>) => void,
): ChorusMcpContextValue<TMeta> {
  const [snapshot, setSnapshot] = React.useState<McpRuntimeSnapshot<TMeta>>(() => ({
    ...(EMPTY_SNAPSHOT as McpRuntimeSnapshot<TMeta>),
  }));
  const runtimeRef = React.useRef<McpRuntime<TMeta> | null>(null);
  const onChangeRef = React.useRef(onChange);

  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const serverKey = React.useMemo(() => JSON.stringify((servers ?? []).map(server => ({
    name: server.name ?? server.url,
    url: server.url,
    transport: server.transport ?? 'sse',
    headers: server.headers ?? null,
    reconnect: server.reconnect ?? true,
    reconnectInitialDelayMs: server.reconnectInitialDelayMs ?? null,
    reconnectMaxDelayMs: server.reconnectMaxDelayMs ?? null,
  }))), [servers]);

  React.useEffect(() => {
    const configs = servers ?? [];
    runtimeRef.current?.dispose();
    runtimeRef.current = null;

    if (configs.length === 0) {
      const empty = { ...(EMPTY_SNAPSHOT as McpRuntimeSnapshot<TMeta>) };
      setSnapshot(empty);
      onChangeRef.current?.(empty);
      return undefined;
    }

    const runtime = createMcpRuntime<TMeta>(configs, next => {
      setSnapshot(next);
      onChangeRef.current?.(next);
    });
    runtimeRef.current = runtime;
    runtime.start();

    return () => {
      runtime.dispose();
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
    // `serverKey` intentionally drives this effect; configs are read from the
    // current render and normalized above so callers can pass fresh arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  const reconnect = React.useCallback((serverName?: string) => {
    runtimeRef.current?.reconnect(serverName);
  }, []);

  const applyPrompt = React.useCallback(async (commandName: string) => {
    const runtime = runtimeRef.current;
    return runtime ? runtime.applyPrompt(commandName) : commandName;
  }, []);

  return React.useMemo(() => ({
    ...snapshot,
    reconnect,
    applyPrompt,
  }), [applyPrompt, reconnect, snapshot]);
}

export function ChorusMcpProvider<TMeta = Record<string, unknown>>({
  servers,
  children,
  onChange,
}: ChorusMcpProviderProps<TMeta>) {
  const value = useMcpRuntime<TMeta>(servers, onChange);
  return <ChorusMcpContext.Provider value={value as ChorusMcpContextValue}>{children}</ChorusMcpContext.Provider>;
}

export function useChorusMcp<TMeta = Record<string, unknown>>(): ChorusMcpContextValue<TMeta> {
  const value = React.useContext(ChorusMcpContext);
  if (!value) {
    return {
      ...(EMPTY_SNAPSHOT as McpRuntimeSnapshot<TMeta>),
      reconnect: () => {},
      applyPrompt: async commandName => commandName,
    };
  }
  return value as ChorusMcpContextValue<TMeta>;
}
