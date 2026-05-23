import React from 'react';
import type { McpRuntime, McpRuntimeSnapshot, McpServerConfig } from '../mcp/types';

const EMPTY_MCP_SNAPSHOT: McpRuntimeSnapshot = {
  servers: [],
  tools: [],
  toolRegistry: {},
  prompts: [],
  slashCommands: [],
  resources: [],
  resourceAttachments: [],
};

export interface LazyMcpRuntime<TMeta = Record<string, unknown>> extends McpRuntimeSnapshot<TMeta> {
  reconnect: (serverName?: string) => void;
  applyPrompt: (commandName: string) => Promise<string>;
}

export function useLazyMcpRuntime<TMeta = Record<string, unknown>>(
  servers: McpServerConfig[] | undefined,
): LazyMcpRuntime<TMeta> {
  const [snapshot, setSnapshot] = React.useState<McpRuntimeSnapshot<TMeta>>(() => ({
    ...(EMPTY_MCP_SNAPSHOT as McpRuntimeSnapshot<TMeta>),
  }));
  const runtimeRef = React.useRef<McpRuntime<TMeta> | null>(null);

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
      setSnapshot({ ...(EMPTY_MCP_SNAPSHOT as McpRuntimeSnapshot<TMeta>) });
      return undefined;
    }

    let cancelled = false;
    let runtime: McpRuntime<TMeta> | null = null;

    void import('../mcp/runtime').then(module => {
      if (cancelled) return;
      runtime = module.createMcpRuntime<TMeta>(configs, setSnapshot);
      runtimeRef.current = runtime;
      runtime.start();
    }).catch(error => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : String(error);
      setSnapshot({
        ...(EMPTY_MCP_SNAPSHOT as McpRuntimeSnapshot<TMeta>),
        servers: configs.map(config => ({
          name: config.name ?? config.url,
          url: config.url,
          transport: config.transport === 'ws' ? 'ws' : 'sse',
          status: 'error',
          error: message,
          reconnectAttempt: 0,
        })),
      });
    });

    return () => {
      cancelled = true;
      runtime?.dispose();
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
