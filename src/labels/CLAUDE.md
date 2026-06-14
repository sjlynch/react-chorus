# src/labels guide

i18n defaults and override plumbing for every user-facing string in the library.

## Layout

- `types.ts` — `ChorusLabels` (the partial override shape consumers pass in) and `ResolvedChorusLabels` (the fully-merged shape components consume).
- `resolve.ts` — assembles `DEFAULT_CHORUS_LABELS` from each section's defaults and exports `resolveChorusLabels()` to merge a user override on top.
- `composer.ts`, `transcript.ts`, `messageActions.ts`, `speakers.ts`, `toolCall.ts`, `codeCopy.ts`, `conversationList.ts`, `attachments.ts`, `reasoning.ts`, `cost.ts`, `artifacts.ts`, `approval.ts`, `mcp.ts` — each owns one `DEFAULT_*_LABELS` constant for its slice of the UI.

## Section ownership of newer surfaces

- `cost.ts` — the conversation cost-meter header (`CostHeader`) and per-message cost chip (`MessageCostChip`); both import `DEFAULT_COST_LABELS` directly so a standalone chip/header stays tree-shakeable.
- `artifacts.ts` — the artifact side-panel (`ChorusArtifactPanel`) and the inline `ArtifactCard`. Both accept a `Partial<ChorusArtifactLabels>` and shallow-merge over `DEFAULT_ARTIFACT_LABELS`, so a host using either standalone overrides only the keys it cares about.
- `approval.ts` — the tool-approval card (`ToolApprovalCard`). `ChorusApprovalLabels` is the canonical type; `ToolApprovalCardLabels`/`DEFAULT_TOOL_APPROVAL_LABELS` remain as aliases for the standalone card's public API.
- `mcp.ts` — the MCP connection-status line in `ChorusShellChrome`.
- Composer additions live in `composer.ts`: `slashCommands` (palette aria-label), `attachResource`/`resourcePickerPlaceholder` (MCP resource picker), and `modelPicker` (provider/model picker fallback aria-label).
- Starter blocks (`blocks/Form.tsx`, `blocks/CalendarPicker.tsx`, `blocks/Image.tsx`) are content-driven and **not** routed through `ChorusLabels`; they expose targeted props (`submitLabel`, `confirmLabel`, `blockedLabel`) instead. The default tool loader's screen-reader "Calling …" string *is* localized via `toolCall.calling`, forwarded by `ToolLoaderSlot`.

## Override merge rule (`isUsableOverride` in `resolve.ts`)

`null`, `undefined`, and `''` keep the default — a loose i18n catalog can't accidentally erase UI text. Whitespace-only strings *are* preserved for the rare "render nothing" case.

## Adding a new label

Three coordinated edits:
1. Add the field to the section type in `types.ts` (and to `ResolvedChorusLabels` if it's a top-level string like `reasoning`/`clearConversation`).
2. Add the default string to the matching `DEFAULT_*_LABELS` constant.
3. Wire it into `DEFAULT_CHORUS_LABELS` and the `resolveChorusLabels()` return in `resolve.ts` (existing sections already merge via `mergeSection`/`mergeString`).

## Why leaf components import section defaults directly

Some leaf components import a single `DEFAULT_*_LABELS` instead of pulling the resolved bundle through context. Deliberate: importing `resolve.ts` would drag in *every* defaults file, defeating tree-shaking. Don't re-export section defaults via `resolve.ts`.
