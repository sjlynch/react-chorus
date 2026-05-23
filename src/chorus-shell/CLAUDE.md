# chorus-shell guide

Internal helpers for the public `<Chorus>` shell live here.

- `derivedState.ts` centralizes derived loading/disabled/action-gating flags plus palette CSS variables used by the shell layout.
- `useComposerActions.ts` owns composer draft/reset state and UI action handlers (send, stop, clear, suggested-prompt focus) that bridge the shell to `useAssistantSession`.
- `props.ts` contains pure prop builders for the root `<div>`, transcript, clear control, and composer so JSX chrome stays mechanically stable.
- `useChorusShellRuntime.ts` normalizes `<Chorus>` props and assembles persistence, message state, assistant session, derived shell state, composer actions, and the imperative ref into `ChorusShellViewProps`.
- `ChorusShellChrome.tsx` is the private JSX shell that renders the root, optional cost meter header, `ChatWindow`, optional clear row, and `ChatInput` from those prepared props.
- `useCostMeter.ts` owns the cost-meter integration. When `<Chorus showCost>` is enabled it wraps `onStreamMetadata` to attach connector-emitted `usage` to the streaming assistant message's `metadata`, aggregates totals via `utils/cost.ts` + the host-overridable `pricing` table, and fires `onBudgetExceeded` exactly once per crossing. The wrapped callback is built from refs so its identity stays stable across renders — `useChorusShellRuntime` keeps `streamingMessageIdRef.current` in sync with `session.streamingMessageId` after the session hook runs.
- `renderCostFooter.tsx` builds the per-bubble cost chip renderer (`renderMessageFooter`) used by the transcript when `showCost` is on. Post-`done` chips read from `cost.byMessageId`; the streaming bubble falls back to the synchronous heuristic in `utils/tokenize.ts`.
- `CostHeader.tsx` is the standalone conversation total + per-model breakdown shown above the transcript.

Keep this folder private to `src/Chorus.tsx`: moving logic here must not change `ChorusProps`, `ChorusRef`, forwarded refs, root CSS classes, labels, headless behavior, or child component prop behavior.
