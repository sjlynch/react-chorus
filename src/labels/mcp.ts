import type { ChorusMcpLabels } from './types';

export const DEFAULT_MCP_LABELS: ChorusMcpLabels = {
  status: ({ name, status }) => `MCP ${name}: ${status}`,
  errorSuffix: (error) => ` — ${error}`,
  reconnectingSuffix: (seconds) => ` (reconnecting in ${seconds}s)`,
  reconnect: 'Reconnect',
};
