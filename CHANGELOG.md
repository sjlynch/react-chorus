# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project uses semantic versioning.

## [Unreleased]

### Added
- Added `onFinish` completion callbacks, imperative `ChorusRef`, forwarded refs/HTML attributes for public components, and headless attachment/upload type exports.
- Documented keyboard shortcuts, standalone `useChorusStream`, persistence examples, error handling, and OpenAI proxy buffering headers.

### Changed
- Bumped the package to `0.2.0` for a public message typing refinement.
- Replaced the public `Message` shape with a discriminated union (`AnyChorusMessage`) so `role: 'tool'` requires `toolCall`, non-tool messages forbid it, and tool/system messages reject attachments.
- Extracted Chorus send/session orchestration into `useAssistantSession` and clarified controlled, transport, connector, and sending-state development warnings.
- `useChorusStream.send()` now rejects non-abort stream failures after cleanup so `onSend` bridges can surface Chorus errors.

### Fixed
- Fixed stream cleanup on unmount/pre-aborted signals, richer HTTP error details, WebSocket close-before-open hangs, safe dev-mode checks without `process`, observer callback isolation, and transport concurrency guards.

### Deprecation candidates (future major)
- The default transport body `{ prompt, history }` duplicates the latest user turn — `prompt` equals `history[history.length - 1].text`. Backends already consume `history` only (see all `examples/` proxies). A future major release should drop `prompt` from `createFetchSSETransport`, `createWebSocketTransport`, and `createDefaultFetchSSETransport` defaults and send `{ history }` exclusively. Until then, README and JSDoc warn against re-appending `prompt` server-side.
