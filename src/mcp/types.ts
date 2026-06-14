import type { Attachment } from '../types';
import type { ChorusToolDefinition } from '../tools';

export type McpTransportKind = 'ws' | 'sse';
export type McpConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export interface McpServerConfig {
  /** Stable display/namespace for this MCP server. Tool, prompt, and resource names are prefixed with it. Defaults to the URL host/path when omitted. */
  name?: string;
  /** Browser-reachable MCP endpoint URL. */
  url: string;
  /** Transport to use. Defaults to `'sse'` because most browser-facing MCP servers expose SSE. */
  transport?: McpTransportKind;
  /** Optional request headers for SSE fetch/POST requests. WebSocket transports ignore headers in browsers. */
  headers?: Record<string, string>;
  /** Disable automatic reconnect attempts. Manual reconnect remains available. Defaults to true. */
  reconnect?: boolean;
  /** Initial reconnect delay in ms. Defaults to 500. */
  reconnectInitialDelayMs?: number;
  /** Maximum reconnect delay in ms. Defaults to 30 seconds. */
  reconnectMaxDelayMs?: number;
}

export interface McpTool {
  serverName: string;
  name: string;
  qualifiedName: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface McpPrompt {
  serverName: string;
  name: string;
  qualifiedName: string;
  slashCommand: string;
  title?: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  raw: Record<string, unknown>;
}

export interface McpResource {
  serverName: string;
  uri: string;
  name: string;
  qualifiedName: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
  raw: Record<string, unknown>;
}

export interface McpServerStatus {
  name: string;
  url: string;
  transport: McpTransportKind;
  status: McpConnectionStatus;
  error?: string;
  reconnectAttempt: number;
  reconnectInMs?: number;
}

export interface McpClientSnapshot {
  server: McpServerStatus;
  tools: McpTool[];
  prompts: McpPrompt[];
  resources: McpResource[];
}

export interface McpCallToolOptions {
  signal?: AbortSignal;
}

export interface McpGetPromptOptions {
  arguments?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface McpReadResourceOptions {
  signal?: AbortSignal;
}

export interface McpClient {
  readonly server: McpServerStatus;
  readonly tools: McpTool[];
  readonly prompts: McpPrompt[];
  readonly resources: McpResource[];
  connect(): Promise<McpClientSnapshot>;
  disconnect(): Promise<void>;
  reconnect(): Promise<McpClientSnapshot>;
  refresh(): Promise<McpClientSnapshot>;
  callTool(name: string, args?: unknown, options?: McpCallToolOptions): Promise<unknown>;
  listPrompts(): Promise<McpPrompt[]>;
  getPrompt(name: string, options?: McpGetPromptOptions): Promise<unknown>;
  listResources(): Promise<McpResource[]>;
  readResource(uri: string, options?: McpReadResourceOptions): Promise<unknown>;
}

export interface McpChorusToolDefinition<TMeta = Record<string, unknown>> extends ChorusToolDefinition<TMeta> {
  /** MCP routing metadata; useful for approvals/policy UIs and custom renderers. */
  mcp: {
    server: string;
    name: string;
    qualifiedName: string;
  };
}

export interface McpSlashCommand {
  name: string;
  description?: string;
  /**
   * True when the underlying prompt declares at least one required argument.
   * The composer uses this to prefill the draft (so the user can append
   * `key=value` arguments) instead of running the prompt immediately when the
   * command is chosen from the slash palette.
   */
  requiresArguments?: boolean;
  prompt: McpPrompt;
}

export interface McpResourceAttachment extends Attachment {
  metadata: Record<string, unknown> & {
    mcp: {
      server: string;
      uri: string;
      name: string;
    };
  };
}

export interface McpRuntimeSnapshot<TMeta = Record<string, unknown>> {
  servers: McpServerStatus[];
  tools: McpChorusToolDefinition<TMeta>[];
  toolRegistry: Record<string, McpChorusToolDefinition<TMeta>>;
  prompts: McpPrompt[];
  slashCommands: McpSlashCommand[];
  resources: McpResource[];
  resourceAttachments: McpResourceAttachment[];
}

export interface McpRuntime<TMeta = Record<string, unknown>> {
  readonly snapshot: McpRuntimeSnapshot<TMeta>;
  start(): void;
  dispose(): void;
  reconnect(serverName?: string): void;
  applyPrompt(commandName: string): Promise<string>;
}
