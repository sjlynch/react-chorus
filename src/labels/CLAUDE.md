# src/labels guide

i18n defaults and override plumbing for every user-facing string in the library.

## Layout

- `types.ts` — `ChorusLabels` (the partial override shape consumers pass in) and `ResolvedChorusLabels` (the fully-merged shape components consume).
- `resolve.ts` — assembles `DEFAULT_CHORUS_LABELS` from each section's defaults and exports `resolveChorusLabels()` to merge a user override on top.
- `composer.ts`, `transcript.ts`, `messageActions.ts`, `speakers.ts`, `toolCall.ts`, `codeCopy.ts`, `conversationList.ts`, `attachments.ts`, `reasoning.ts` — each owns one `DEFAULT_*_LABELS` constant for its slice of the UI.

## Override merge rule (`isUsableOverride` in `resolve.ts`)

`null`, `undefined`, and `''` keep the default — a loose i18n catalog can't accidentally erase UI text. Whitespace-only strings *are* preserved for the rare "render nothing" case.

## Adding a new label

Three coordinated edits:
1. Add the field to the section type in `types.ts` (and to `ResolvedChorusLabels` if it's a top-level string like `reasoning`/`clearConversation`).
2. Add the default string to the matching `DEFAULT_*_LABELS` constant.
3. Wire it into `DEFAULT_CHORUS_LABELS` and the `resolveChorusLabels()` return in `resolve.ts` (existing sections already merge via `mergeSection`/`mergeString`).

## Why leaf components import section defaults directly

Some leaf components import a single `DEFAULT_*_LABELS` instead of pulling the resolved bundle through context. Deliberate: importing `resolve.ts` would drag in *every* defaults file, defeating tree-shaking. Don't re-export section defaults via `resolve.ts`.
