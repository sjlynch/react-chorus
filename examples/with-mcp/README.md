# react-chorus MCP example

This Next.js example demonstrates the browser-side MCP client built into
`<Chorus mcpServers={...}>`. The widget connects directly to a local MCP
server from the browser; the demo `/api/chat` route only emits OpenAI-shaped SSE
chunks so Chorus has an assistant turn that calls an MCP tool.

## Run

From the repository root, build the library once:

```bash
npm install
npm run build
```

In one terminal, start an MCP everything server with SSE enabled:

```bash
cd examples/with-mcp
npm run mcp:everything
```

In a second terminal, start Next.js:

```bash
cd examples/with-mcp
npm install
npm run dev
```

Open the printed Next.js URL (usually <http://localhost:3000>). Ask Chorus to
"call the MCP echo tool". The route emits a tool call named `everything:echo`,
Chorus routes it through the browser MCP client, and the tool output appears in
the normal tool-call UI before the automatic continuation summarizes it.

Set `NEXT_PUBLIC_MCP_URL` if your MCP server is not at
`http://localhost:3001/sse`.

## What to try

- Disconnect the MCP server: Chorus shows a status row with reconnect backoff
  and a manual **Reconnect** button.
- Type `/everything:` in the composer to see MCP prompts in the slash-command
  palette.
- Use the resource picker in the composer when the server advertises resources;
  selected MCP resources are attached as references.
