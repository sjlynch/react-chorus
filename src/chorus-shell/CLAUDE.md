# chorus-shell guide

Internal helpers for the public `<Chorus>` shell live here.

- `derivedState.ts` centralizes derived loading/disabled/action-gating flags plus palette CSS variables used by the shell layout.
- `useComposerActions.ts` owns composer draft/reset state and UI action handlers (send, stop, clear, suggested-prompt focus) that bridge the shell to `useAssistantSession`.
- `props.ts` contains pure prop builders for the root `<div>`, transcript, clear control, and composer so JSX chrome stays mechanically stable.
- `useChorusShellRuntime.ts` normalizes `<Chorus>` props and assembles persistence, message state, assistant session, derived shell state, composer actions, and the imperative ref into `ChorusShellViewProps`.
- `ChorusShellChrome.tsx` is the private JSX shell that renders the root, `ChatWindow`, optional clear row, and `ChatInput` from those prepared props.

Keep this folder private to `src/Chorus.tsx`: moving logic here must not change `ChorusProps`, `ChorusRef`, forwarded refs, root CSS classes, labels, headless behavior, or child component prop behavior.
