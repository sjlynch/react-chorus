# Migration and Upgrading

This page is the canonical place to look up breaking changes and deprecations release-over-release. The matching changelog entries live in [`CHANGELOG.md`](../CHANGELOG.md) — anything labelled "Deprecation candidate" there is documented here with a concrete migration path before it ships as a breaking change.

## Connector public API: `getConnector` is canonical

There is exactly one supported way to obtain a connector. Select a built-in connector **by name** — `connector="openai"` on `<Chorus>`, `{ connector: 'openai' }` on `useChorusStream`, or `getConnector('openai')` for a connector object. Customize it with `connectorOptions` (widget/hook) or the `options` argument of `getConnector`. For a connector object you build yourself, use `createOpenAIConnector(options)` or implement the `Connector` interface directly.

The provider connector singletons (`openaiConnector`, `anthropicConnector`, `geminiConnector`, `aiSdkConnector`) and `autoConnector` are **`@internal`** and are not exported from `react-chorus` or `react-chorus/headless`. They duplicated the string registry — a second public API doing the same job — so the barrel exports only `getConnector` and `createOpenAIConnector`. If a pre-release imported a singleton directly, switch to the equivalent name: `openaiConnector` → `getConnector('openai')`, `anthropicConnector` → `getConnector('anthropic')`, `geminiConnector` → `getConnector('gemini')`, `aiSdkConnector` → `getConnector('ai-sdk')`, `autoConnector` → `getConnector('auto')` (or `getConnector()`).

## Unreleased — upgrade notes

These changes land in the next release off `[Unreleased]`. None break `ChorusProps` or an exported component/hook contract, but three are visible behavior changes worth checking before you upgrade.

### Markdown flow typography no longer depends on the browser's UA stylesheet

The injected `chorus-md` sheet styled tables and code blocks but left paragraphs, headings, lists, list items, blockquotes, and `<hr>` to the UA defaults. In a host that ships a CSS reset — `* { margin: 0; padding: 0 }`, normalize.css, Tailwind preflight — those defaults are gone, so `list-style-position: outside` markers rendered to the left of the list's content box: **outside the bubble's padding, painted on or past its border.** Nesting levels collapsed onto one indent and blocks lost their vertical spacing. The sheet now declares this typography itself. **This is a visible rendering change for every `<Markdown>` / `<Chorus>` consumer** — lists gain a `2em` indent, blocks gain `em`-relative margins, and blockquotes gain an indent plus a leading rule. If you were compensating in your own stylesheet, drop the override. Three new CSS variables theme the result: `--chorus-md-quote-border`, `--chorus-md-quote-text`, and `--chorus-md-rule`. The headless build injects no stylesheet, so this typography is still yours to supply there.

### GFM tables are now styled by the bundled `chorus-md` stylesheet

`marked`'s `gfm: true` already emitted real `<table>` markup, but the injected `chorus-md` sheet only styled code blocks, so Markdown tables rendered as borderless rows of text. The sheet now gives them collapsed borders, 1px cell borders, cell padding, and an emphasized header row. **This is a visible rendering change for every `<Markdown>` / `<Chorus>` consumer that renders tables** — review table-heavy transcripts after upgrading. Two new CSS variables theme the result: `--chorus-md-table-border` (cell border color) and `--chorus-md-table-header-bg` (header row background). Override them alongside the other `--chorus-*` variables (see [Theming](api.md#theming)). The headless build injects no stylesheet, so style tables yourself there.

### New `ai-sdk` connector

A built-in `'ai-sdk'` connector parses [Vercel AI SDK](guide.md#vercel-ai-sdk-stream-format) streams — both the v5+ UI message stream (`toUIMessageStreamResponse()`) and the v4 data-stream protocol (`toDataStreamResponse()`). Select it with `connector="ai-sdk"`, or rely on the default `connector="auto"`, which now detects AI SDK frames too. Like the other built-in connectors it is reachable by name only — there is no exported `aiSdkConnector` singleton; see [Connector public API](#connector-public-api-getconnector-is-canonical).

### Default error banner gains a dismiss button

The built-in transcript error banner now renders a dismiss (X) button whenever `onDismissError` is wired — which it always is under `<Chorus>`. Consumers using the default error UI (not a custom `renderError`) can now clear the banner without retrying. The new `labels.transcript.dismissError` string localizes its accessible label.

## Unreleased — deprecation candidates

### Default transport body will drop the `prompt` field

**Status:** still emitted today; planned removal in the next major.

**What ships today.** `createFetchSSETransport` and `createWebSocketTransport` (and the default `transport="/api/chat"` shorthand, which builds a `createFetchSSETransport` internally) all POST/send the body `{ prompt, history }` by default, where `prompt` equals `history[history.length - 1].text`. It is a convenience duplicate of the latest user turn — useful for very small toy backends, redundant for everything else. Every example backend in this repo (`examples/with-openai/server`, `examples/with-next`, the Express/Next.js/Gemini/WebSocket snippets in the docs) already reads `history` only and explicitly ignores `prompt`.

**What changes in the next major.** The default request body will be `{ history }` — `prompt` will no longer be present, and the inline comments warning backends not to re-append `body.prompt` will be removed. The `formatBody` override remains the supported escape hatch for any backend that still wants a separate field.

**How to migrate, ahead of the major.** On the server, read `history` (always present today and after the change) and never re-append `req.body.prompt` / `frame.prompt` — the latest user text is `history[history.length - 1].text`. On the client, if you need a custom body shape, pass `formatBody: (text, history) => JSON.stringify({ text, history })` to the transport you're constructing instead of relying on the default. After the major lands, callers reading `req.body.prompt` will see `undefined` and silently send an empty turn to the model, so do this work now if you haven't already.

**Why now.** Bodies have been documented as `{ prompt, history }` since 0.x and a handful of toy backends still echo `prompt`. Keeping the duplicate field on the wire indefinitely is a permanent footgun (the "message sent twice" failure mode that every backend snippet currently warns about) — the deprecation candidate makes the breaking change explicit so apps can move to `{ history }` on their own schedule before the major lands.

> Tracked under the [`[Unreleased]` → Deprecation candidates (future major)](../CHANGELOG.md#deprecation-candidates-future-major) section of the changelog.
