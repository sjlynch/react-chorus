import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type {
  McpClient,
  McpClientSnapshot,
  McpConnectionStatus,
  McpGetPromptOptions,
  McpPrompt,
  McpReadResourceOptions,
  McpResource,
  McpServerConfig,
  McpServerStatus,
  McpTool,
} from './types';

const CLIENT_VERSION = '0.2.0';

type SdkClient = Client;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function ownRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? { ...(value as Record<string, unknown>) } : {};
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const raw = value[key];
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  const raw = value[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function normalizeTransport(transport: McpServerConfig['transport']): 'ws' | 'sse' {
  return transport === 'ws' ? 'ws' : 'sse';
}

export function qualifyMcpName(serverName: string, name: string): string {
  return `${serverName}:${name}`;
}

export function resolveMcpServerName(config: McpServerConfig): string {
  const explicit = config.name?.trim();
  if (explicit) return explicit;
  try {
    const url = new URL(config.url);
    const path = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\W+/g, '-');
    return (path ? `${url.hostname}-${path}` : url.hostname) || 'mcp';
  } catch {
    return 'mcp';
  }
}

function stripServerPrefix(serverName: string, name: string): string {
  const prefix = `${serverName}:`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

function createStatus(config: McpServerConfig, status: McpConnectionStatus): McpServerStatus {
  return {
    name: resolveMcpServerName(config),
    url: config.url,
    transport: normalizeTransport(config.transport),
    status,
    reconnectAttempt: 0,
  };
}

function makeTransport(config: McpServerConfig): Transport {
  const url = new URL(config.url);
  if (normalizeTransport(config.transport) === 'ws') {
    return new WebSocketClientTransport(url);
  }

  const headers = config.headers && Object.keys(config.headers).length > 0
    ? { headers: config.headers }
    : undefined;

  return new SSEClientTransport(url, {
    requestInit: headers,
  });
}

function normalizeTools(serverName: string, tools: unknown[]): McpTool[] {
  return tools.map(tool => {
    const raw = ownRecord(tool);
    const name = stringField(raw, 'name') ?? 'tool';
    const inputSchema = ownRecord(raw.inputSchema);
    const outputSchema = ownRecord(raw.outputSchema);
    return {
      serverName,
      name,
      qualifiedName: qualifyMcpName(serverName, name),
      title: stringField(raw, 'title'),
      description: stringField(raw, 'description'),
      inputSchema: Object.keys(inputSchema).length ? inputSchema : undefined,
      outputSchema: Object.keys(outputSchema).length ? outputSchema : undefined,
      raw,
    };
  });
}

function normalizePrompts(serverName: string, prompts: unknown[]): McpPrompt[] {
  return prompts.map(prompt => {
    const raw = ownRecord(prompt);
    const name = stringField(raw, 'name') ?? 'prompt';
    const args = Array.isArray(raw.arguments)
      ? raw.arguments.map(item => {
        const arg = ownRecord(item);
        return {
          name: stringField(arg, 'name') ?? '',
          description: stringField(arg, 'description'),
          required: Boolean(arg.required),
        };
      }).filter(arg => arg.name.length > 0)
      : undefined;
    const qualifiedName = qualifyMcpName(serverName, name);
    return {
      serverName,
      name,
      qualifiedName,
      slashCommand: `/${qualifiedName}`,
      title: stringField(raw, 'title'),
      description: stringField(raw, 'description'),
      arguments: args,
      raw,
    };
  });
}

function normalizeResources(serverName: string, resources: unknown[]): McpResource[] {
  return resources.map(resource => {
    const raw = ownRecord(resource);
    const uri = stringField(raw, 'uri') ?? '';
    const name = stringField(raw, 'name') ?? (uri || 'resource');
    return {
      serverName,
      uri,
      name,
      qualifiedName: qualifyMcpName(serverName, name),
      title: stringField(raw, 'title'),
      description: stringField(raw, 'description'),
      mimeType: stringField(raw, 'mimeType'),
      size: numberField(raw, 'size'),
      raw,
    };
  }).filter(resource => resource.uri.length > 0);
}

function requestOptions(signal?: AbortSignal) {
  return signal ? { signal } : undefined;
}

function promptArguments(args: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!args) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value == null) continue;
    out[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return out;
}

export interface CreateMcpClientOptions {
  onStatusChange?: (status: McpServerStatus) => void;
}

export function createMcpClient(config: McpServerConfig, options: CreateMcpClientOptions = {}): McpClient {
  const serverName = resolveMcpServerName(config);
  let client: SdkClient | null = null;
  let transport: Transport | null = null;
  let tools: McpTool[] = [];
  let prompts: McpPrompt[] = [];
  let resources: McpResource[] = [];
  let status = createStatus(config, 'idle');

  const snapshot = (): McpClientSnapshot => ({
    server: { ...status },
    tools: [...tools],
    prompts: [...prompts],
    resources: [...resources],
  });

  const setStatus = (next: McpConnectionStatus, error?: unknown) => {
    status = {
      ...status,
      status: next,
      error: error == null ? undefined : toErrorMessage(error),
    };
    options.onStatusChange?.({ ...status });
  };

  const closeTransport = async () => {
    const currentClient = client;
    const currentTransport = transport;
    client = null;
    transport = null;
    try {
      await currentClient?.close();
    } catch {
      // Prefer closing the underlying transport below; SDK close can throw if
      // the connection is already gone.
    }
    try {
      await currentTransport?.close();
    } catch {
      // Ignore close races. The next connect creates a fresh transport/client.
    }
  };

  const refresh = async (): Promise<McpClientSnapshot> => {
    if (!client) throw new Error(`MCP server "${serverName}" is not connected.`);
    const [toolResult, promptResult, resourceResult] = await Promise.allSettled([
      client.listTools(),
      client.listPrompts(),
      client.listResources(),
    ]);

    tools = toolResult.status === 'fulfilled'
      ? normalizeTools(serverName, toolResult.value.tools ?? [])
      : [];
    prompts = promptResult.status === 'fulfilled'
      ? normalizePrompts(serverName, promptResult.value.prompts ?? [])
      : [];
    resources = resourceResult.status === 'fulfilled'
      ? normalizeResources(serverName, resourceResult.value.resources ?? [])
      : [];

    return snapshot();
  };

  const connect = async (): Promise<McpClientSnapshot> => {
    await closeTransport();
    setStatus(status.status === 'reconnecting' ? 'reconnecting' : 'connecting');

    const nextClient = new Client({ name: 'react-chorus', version: CLIENT_VERSION }, {
      capabilities: {},
    });
    const nextTransport = makeTransport(config);
    nextTransport.onerror = error => {
      setStatus('error', error);
    };
    nextTransport.onclose = () => {
      if (status.status !== 'disconnected') setStatus('disconnected');
    };

    client = nextClient;
    transport = nextTransport;

    try {
      await nextClient.connect(nextTransport);
      setStatus('connected');
      return await refresh();
    } catch (error) {
      setStatus('error', error);
      await closeTransport();
      throw error;
    }
  };

  const api: McpClient = {
    get server() {
      return { ...status };
    },
    get tools() {
      return [...tools];
    },
    get prompts() {
      return [...prompts];
    },
    get resources() {
      return [...resources];
    },
    connect,
    async disconnect() {
      setStatus('disconnected');
      await closeTransport();
    },
    async reconnect() {
      status = { ...status, status: 'reconnecting' };
      return connect();
    },
    refresh,
    async callTool(name, args, options) {
      if (!client) throw new Error(`MCP server "${serverName}" is not connected.`);
      const actualName = stripServerPrefix(serverName, name.replace(/^\//, ''));
      return client.callTool({ name: actualName, arguments: ownRecord(args) }, undefined, requestOptions(options?.signal));
    },
    async listPrompts() {
      if (!client) throw new Error(`MCP server "${serverName}" is not connected.`);
      const result = await client.listPrompts();
      prompts = normalizePrompts(serverName, result.prompts ?? []);
      return [...prompts];
    },
    async getPrompt(name: string, options?: McpGetPromptOptions) {
      if (!client) throw new Error(`MCP server "${serverName}" is not connected.`);
      const actualName = stripServerPrefix(serverName, name.replace(/^\//, ''));
      return client.getPrompt({ name: actualName, arguments: promptArguments(options?.arguments) }, requestOptions(options?.signal));
    },
    async listResources() {
      if (!client) throw new Error(`MCP server "${serverName}" is not connected.`);
      const result = await client.listResources();
      resources = normalizeResources(serverName, result.resources ?? []);
      return [...resources];
    },
    async readResource(uri: string, options?: McpReadResourceOptions) {
      if (!client) throw new Error(`MCP server "${serverName}" is not connected.`);
      return client.readResource({ uri }, requestOptions(options?.signal));
    },
  };

  return api;
}
