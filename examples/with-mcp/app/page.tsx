'use client';

import { Chorus, type McpServerConfig } from 'react-chorus';

const mcpServers: McpServerConfig[] = [
  {
    name: 'everything',
    url: process.env.NEXT_PUBLIC_MCP_URL ?? 'http://localhost:3001/sse',
    transport: 'sse',
  },
];

export default function Page() {
  return (
    <main style={{ height: '100dvh', padding: 16, boxSizing: 'border-box' }}>
      <Chorus
        transport="/api/chat"
        connector="openai"
        mcpServers={mcpServers}
        autoContinueTools
        continueOnToolError
        suggestedPrompts={[
          'Show me the MCP tools you discovered',
          'Call the MCP echo tool with hello from Chorus',
          'Type /everything: and pick an MCP prompt',
        ]}
        errorMessage="The MCP demo route could not complete that request."
        onError={(error) => console.error(error)}
      />
    </main>
  );
}
