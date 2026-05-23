import type { Attachment } from '../types';
import type { ChorusToolCallContext } from '../hooks/useAssistantSession';
import { createMcpClient, resolveMcpServerName } from './client';
import type {
  McpChorusToolDefinition,
  McpClient,
  McpClientSnapshot,
  McpPrompt,
  McpResource,
  McpResourceAttachment,
  McpRuntime,
  McpRuntimeSnapshot,
  McpServerConfig,
  McpServerStatus,
  McpSlashCommand,
} from './types';

const DEFAULT_INITIAL_RECONNECT_DELAY_MS = 500;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 30_000;
const RECONNECT_GROWTH = 2;

interface ServerRuntime<TMeta> {
  config: McpServerConfig;
  client: McpClient;
  snapshot: McpClientSnapshot;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  disposed: boolean;
  reconnectAttempt: number;
  generation: number;
  tools: McpChorusToolDefinition<TMeta>[];
}

function emptyServerSnapshot(config: McpServerConfig): McpClientSnapshot {
  return {
    server: {
      name: resolveMcpServerName(config),
      url: config.url,
      transport: config.transport === 'ws' ? 'ws' : 'sse',
      status: 'idle',
      reconnectAttempt: 0,
    },
    tools: [],
    prompts: [],
    resources: [],
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function serverDelay(config: McpServerConfig, attempt: number): number {
  const initial = Math.max(0, config.reconnectInitialDelayMs ?? DEFAULT_INITIAL_RECONNECT_DELAY_MS);
  const max = Math.max(initial, config.reconnectMaxDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS);
  return Math.min(max, Math.round(initial * (RECONNECT_GROWTH ** Math.max(0, attempt - 1))));
}

function promptToCommand(prompt: McpPrompt): McpSlashCommand {
  return {
    name: prompt.slashCommand,
    description: prompt.description ?? prompt.title,
    prompt,
  };
}

function resourceToAttachment(resource: McpResource): McpResourceAttachment {
  const name = resource.title ?? resource.name;
  const type = resource.mimeType ?? 'application/x-mcp-resource';
  const data = resource.uri;
  const attachment: Attachment = {
    id: resource.uri,
    name,
    type,
    data,
    size: resource.size ?? 0,
    url: resource.uri.startsWith('http://') || resource.uri.startsWith('https://') ? resource.uri : undefined,
    metadata: {
      mcp: {
        server: resource.serverName,
        uri: resource.uri,
        name: resource.name,
      },
      description: resource.description,
      title: resource.title,
      qualifiedName: resource.qualifiedName,
      reference: true,
    },
  };
  return attachment as McpResourceAttachment;
}

function promptResultToText(result: unknown, fallback: string): string {
  if (!result || typeof result !== 'object') return fallback;
  const value = result as { messages?: Array<{ content?: unknown }> };
  if (!Array.isArray(value.messages)) return fallback;

  const parts: string[] = [];
  for (const message of value.messages) {
    const content = message.content;
    if (!content || typeof content !== 'object') continue;
    const record = content as Record<string, unknown>;
    if (record.type === 'text' && typeof record.text === 'string') parts.push(record.text);
    if (record.type === 'resource' && record.resource && typeof record.resource === 'object') {
      const resource = record.resource as Record<string, unknown>;
      if (typeof resource.text === 'string') parts.push(resource.text);
      else if (typeof resource.uri === 'string') parts.push(resource.uri);
    }
  }

  return parts.join('\n\n').trim() || fallback;
}

function makeToolDefinition<TMeta>(client: McpClient, serverName: string, toolName: string, qualifiedName: string, description?: string, inputSchema?: Record<string, unknown>, outputSchema?: Record<string, unknown>): McpChorusToolDefinition<TMeta> {
  return {
    name: qualifiedName,
    description,
    inputSchema,
    // MCP servers can run arbitrary side-effectful operations on the host's
    // behalf, so every MCP tool defaults to `requiresApproval: true`. The
    // user can flip this off per tool via `toolPolicy.perTool` or by clicking
    // "Allow always" on the approval card. Hosts that fully trust an MCP
    // server can suppress the gate with `toolPolicy.perTool[qualifiedName]: 'allow'`.
    requiresApproval: true,
    handler: (input: unknown, context: ChorusToolCallContext<TMeta>) => client.callTool(toolName, input, { signal: context.signal }),
    mcp: {
      server: serverName,
      name: toolName,
      qualifiedName,
    },
    ...(outputSchema ? { outputSchema } : {}),
  } as McpChorusToolDefinition<TMeta>;
}

function toolsFromSnapshot<TMeta>(client: McpClient, snapshot: McpClientSnapshot): McpChorusToolDefinition<TMeta>[] {
  return snapshot.tools.map(tool => makeToolDefinition<TMeta>(
    client,
    tool.serverName,
    tool.name,
    tool.qualifiedName,
    tool.description ?? tool.title,
    tool.inputSchema,
    tool.outputSchema,
  ));
}

export function createMcpRuntime<TMeta = Record<string, unknown>>(
  servers: McpServerConfig[],
  onChange: (snapshot: McpRuntimeSnapshot<TMeta>) => void,
): McpRuntime<TMeta> {
  const handleClientStatus = (runtime: ServerRuntime<TMeta>, status: McpServerStatus) => {
    if (runtime.disposed) return;
    const wasConnecting = runtime.snapshot.server.status === 'connecting' || runtime.snapshot.server.status === 'reconnecting';
    runtime.snapshot = {
      ...runtime.snapshot,
      server: {
        ...status,
        reconnectAttempt: runtime.reconnectAttempt,
      },
    };
    if (status.status === 'disconnected' || status.status === 'error') {
      runtime.tools = [];
      runtime.snapshot = { ...runtime.snapshot, tools: [], prompts: [], resources: [] };
      emit();
      if (!wasConnecting && runtime.config.reconnect !== false) scheduleReconnect(runtime);
      return;
    }
    emit();
  };

  const runtimes: ServerRuntime<TMeta>[] = servers.map(config => {
    let runtime: ServerRuntime<TMeta> | null = null;
    const client = createMcpClient(config, {
      onStatusChange: status => {
        if (runtime) handleClientStatus(runtime, status);
      },
    });
    const nextRuntime: ServerRuntime<TMeta> = {
      config,
      client,
      snapshot: emptyServerSnapshot(config),
      reconnectTimer: null,
      disposed: false,
      reconnectAttempt: 0,
      generation: 0,
      tools: [],
    };
    runtime = nextRuntime;
    return nextRuntime;
  });

  let current: McpRuntimeSnapshot<TMeta> = {
    servers: runtimes.map(runtime => runtime.snapshot.server),
    tools: [],
    toolRegistry: {},
    prompts: [],
    slashCommands: [],
    resources: [],
    resourceAttachments: [],
  };

  const emit = () => {
    const tools = runtimes.flatMap(runtime => runtime.tools);
    const prompts = runtimes.flatMap(runtime => runtime.snapshot.prompts);
    const resources = runtimes.flatMap(runtime => runtime.snapshot.resources);
    current = {
      servers: runtimes.map(runtime => runtime.snapshot.server),
      tools,
      toolRegistry: Object.fromEntries(tools.map(tool => [tool.name, tool])),
      prompts,
      slashCommands: prompts.map(promptToCommand),
      resources,
      resourceAttachments: resources.map(resourceToAttachment),
    };
    onChange(current);
  };

  const patchServerStatus = (runtime: ServerRuntime<TMeta>, status: Partial<McpServerStatus>) => {
    runtime.snapshot = {
      ...runtime.snapshot,
      server: {
        ...runtime.snapshot.server,
        ...status,
      },
    };
    emit();
  };

  const clearReconnect = (runtime: ServerRuntime<TMeta>) => {
    if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
    runtime.reconnectTimer = null;
  };

  const connectRuntime = async (runtime: ServerRuntime<TMeta>, reason: 'connect' | 'reconnect' | 'manual' = 'connect') => {
    clearReconnect(runtime);
    const generation = runtime.generation + 1;
    runtime.generation = generation;
    patchServerStatus(runtime, {
      status: reason === 'connect' ? 'connecting' : 'reconnecting',
      error: undefined,
      reconnectAttempt: runtime.reconnectAttempt,
      reconnectInMs: undefined,
    });

    try {
      const snapshot = reason === 'connect'
        ? await runtime.client.connect()
        : await runtime.client.reconnect();
      if (runtime.disposed || generation !== runtime.generation) return;
      runtime.reconnectAttempt = 0;
      runtime.snapshot = {
        ...snapshot,
        server: {
          ...snapshot.server,
          reconnectAttempt: 0,
          reconnectInMs: undefined,
        },
      };
      runtime.tools = toolsFromSnapshot<TMeta>(runtime.client, snapshot);
      emit();
    } catch (error) {
      if (runtime.disposed || generation !== runtime.generation) return;
      runtime.tools = [];
      runtime.snapshot = {
        ...runtime.snapshot,
        tools: [],
        prompts: [],
        resources: [],
        server: {
          ...runtime.snapshot.server,
          status: 'error',
          error: toErrorMessage(error),
          reconnectAttempt: runtime.reconnectAttempt,
        },
      };
      emit();
      if (runtime.config.reconnect !== false) scheduleReconnect(runtime);
    }
  };

  function scheduleReconnect(runtime: ServerRuntime<TMeta>) {
    if (runtime.disposed || runtime.reconnectTimer) return;
    runtime.reconnectAttempt += 1;
    const delay = serverDelay(runtime.config, runtime.reconnectAttempt);
    patchServerStatus(runtime, {
      status: 'reconnecting',
      reconnectAttempt: runtime.reconnectAttempt,
      reconnectInMs: delay,
    });
    runtime.reconnectTimer = setTimeout(() => {
      runtime.reconnectTimer = null;
      void connectRuntime(runtime, 'reconnect');
    }, delay);
  }

  const api: McpRuntime<TMeta> = {
    get snapshot() {
      return current;
    },
    start() {
      emit();
      for (const runtime of runtimes) {
        void connectRuntime(runtime, 'connect');
      }
    },
    dispose() {
      for (const runtime of runtimes) {
        runtime.disposed = true;
        runtime.generation += 1;
        clearReconnect(runtime);
        void runtime.client.disconnect();
      }
    },
    reconnect(serverName?: string) {
      for (const runtime of runtimes) {
        if (serverName && resolveMcpServerName(runtime.config) !== serverName) continue;
        runtime.reconnectAttempt = 0;
        void connectRuntime(runtime, 'manual');
      }
    },
    async applyPrompt(commandName: string) {
      const normalized = commandName.startsWith('/') ? commandName : `/${commandName}`;
      const prompt = current.prompts.find(item => item.slashCommand === normalized || item.qualifiedName === normalized.slice(1));
      if (!prompt) return commandName;
      const runtime = runtimes.find(item => resolveMcpServerName(item.config) === prompt.serverName);
      if (!runtime) return commandName;
      const result = await runtime.client.getPrompt(prompt.name);
      return promptResultToText(result, prompt.slashCommand);
    },
  };

  return api;
}

export type {
  McpChorusToolDefinition,
  McpRuntime,
  McpRuntimeSnapshot,
  McpServerConfig,
  McpServerStatus,
  McpSlashCommand,
};
