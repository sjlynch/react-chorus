# chorus-shell guide

Internal helpers for the public `<Chorus>` shell live here.

- `derivedState.ts` centralizes derived loading/disabled/action-gating flags plus palette CSS variables used by the shell layout.
- `useComposerActions.ts` owns composer draft/reset state and UI action handlers (send, stop, clear, suggested-prompt focus) that bridge the shell to `useAssistantSession`.

Keep this folder private to `src/Chorus.tsx`: moving logic here must not change `ChorusProps`, `ChorusRef`, forwarded refs, root CSS classes, or child component prop behavior.
