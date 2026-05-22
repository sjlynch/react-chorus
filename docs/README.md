# react-chorus documentation

The root [`README.md`](../README.md) covers the happy path — install, Quick start, the two send paths, and the runnable examples. This directory holds the full reference material.

| Page | What's in it |
|------|--------------|
| [Usage guide](guide.md) | The two send paths (`transport` / `onSend`) in full, auth headers, the WebSocket transport, Next.js/Express/`ws` backends, provider request helpers, connectors, named SSE events, and the OpenAI / Anthropic / Gemini / Vercel AI SDK stream formats. |
| [API reference](api.md) | Every `<Chorus>` prop, the `helpers` passed to `onSend`, `ChorusRef`, persistence, `useChorusStream`, the transport factories, custom connectors, tool calls and agent steps, theming, the individual components, and the `Message` shape. |
| [Out-of-band attachment uploads](uploads.md) | An end-to-end `uploadAttachment` recipe for large or non-image files — a real `/api/uploads` endpoint and the matching provider file-reference mapping. |
| [Deployment notes](deployment.md) | Bundle-size budgets, SSR and Markdown sanitization, and a strict Content-Security-Policy guide. |
| [Migration and Upgrading](migration.md) | Breaking changes, deprecation candidates, and concrete migration paths release-over-release. |

Runnable apps live in [`/examples`](../examples); the changelog is [`CHANGELOG.md`](../CHANGELOG.md).
