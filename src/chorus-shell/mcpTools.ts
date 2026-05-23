import type { ChorusToolDefinition } from '../tools';
import type { ChorusToolRegistry } from '../hooks/useAssistantSession';
import type { McpChorusToolDefinition } from '../mcp/types';

function mcpRawName<TMeta>(definition: ChorusToolDefinition<TMeta>): string | undefined {
  return (definition as McpChorusToolDefinition<TMeta>).mcp?.name;
}

export function mergeMcpTools<TMeta>(
  nativeTools: ChorusToolRegistry<TMeta> | undefined,
  mcpTools: ChorusToolDefinition<TMeta>[],
): ChorusToolRegistry<TMeta> | undefined {
  if (mcpTools.length === 0) return nativeTools;

  const merged: Record<string, unknown> = {};

  if (Array.isArray(nativeTools)) {
    for (const definition of nativeTools) {
      if (definition?.name) merged[definition.name] = definition;
    }
  } else if (nativeTools) {
    Object.assign(merged, nativeTools);
  }

  const rawCounts = new Map<string, number>();
  for (const definition of mcpTools) {
    const raw = mcpRawName(definition);
    if (raw) rawCounts.set(raw, (rawCounts.get(raw) ?? 0) + 1);
  }

  for (const definition of mcpTools) {
    if (definition?.name) merged[definition.name] = definition;
    const raw = mcpRawName(definition);
    // Be forgiving when a model/provider emits the raw MCP tool name instead of
    // the advertised `<server>:<tool>` name, but only when that raw name is
    // unambiguous and does not override a host-native tool.
    if (raw && rawCounts.get(raw) === 1 && !(raw in merged)) merged[raw] = definition;
  }

  return merged as ChorusToolRegistry<TMeta>;
}
