# Markdown.tsx: fix marked global mutation and fence detection false positive

Two tasks that both edit src/components/Markdown.tsx and must be done in one pass to avoid merge conflicts.

---

## Bug 1: marked global instance mutation + removed options

File: src/components/Markdown.tsx lines ~57-60 and the marked.parse() call

Two problems:
1. `mangle` and `headerIds` were removed in marked v5 (this library uses v16). The TypeScript cast `as Parameters<typeof marked.setOptions>[0] & { mangle: boolean; headerIds: boolean }` suppresses the compiler error but these options have no effect at runtime.
2. `marked.setOptions()` and `marked.use(markedHighlight(...))` mutate the global `marked` singleton. Any app code that also uses `marked` will silently inherit Chorus's GFM/breaks configuration and the highlight extension.

Fix: replace the global singleton with a private instance using the modern per-instance API (available since marked v5):

```ts
import { Marked } from 'marked';
const markedInstance = new Marked({ gfm: true, breaks: true });
markedInstance.use(markedHighlight({ ... }));
```

Update all calls from `marked.parse(balanced)` → `markedInstance.parse(balanced)`.

Remove the TypeScript cast entirely — the `Marked` constructor accepts only current options, so `mangle`/`headerIds` cannot be passed.

---

## Bug 2: normalizeStreamingMarkdown false positive for inline triple-backticks

File: src/components/Markdown.tsx lines ~76-90

The function counts every occurrence of ` ``` ` in the string. GFM fences are only valid at the start of a line (optionally after 0–3 spaces). Inline backtick sequences are incorrectly treated as fence openers.

Example that misfires: `"To open a code block, use \`\`\` on its own line."` — count=1 (odd) → spurious closing fence appended → prose is wrapped in a code block.

Also breaks during streaming when an assistant mentions ` ``` ` in prose before an actual code block begins.

Fix: count only occurrences where the fence starts at position 0 or immediately after a newline:

```ts
const isAtLineStart = (pos: number) => pos === 0 || out[pos - 1] === '\n';
// inside the while loop: if (isAtLineStart(pos)) count++;
```

Acceptance criteria:
- `"Use \`\`\` for code"` does NOT trigger fence closure
- An actual fenced code block on its own line still gets closed correctly when the stream is mid-fence

---

**Lattice task ID:** `t_1778535809336_f6pjp`
**Created:** 2026-05-11T21:43:29.336Z

## Instructions (please complete autonomously, no need to confirm with the user)

1. **Check existing state first.** This task may have been started in a
   prior session — Lattice can resume worktrees after a server restart or
   when Claude finishes without committing. Before doing anything, run:

   ```
   git log --oneline -10
   git status
   ```

   - If there are commits on this branch, read them with `git show <sha>`
     to understand what's already been implemented.
   - If there are uncommitted changes, review them with `git diff` and
     decide whether to keep, amend, or rework them.
   - Only redo work that's clearly broken or out of scope. Don't restart
     the implementation from scratch when it's already partially done.

2. Implement the task described above (continuing from the prior state if
   any).

3. **Commit your work** before ending the session — Lattice merges your
   branch via `git merge`, so a commit is required for changes to land:

   ```
   git add -A
   git commit -m "<concise summary of the change>"
   ```

4. **Append a short summary of your changes to the task** so the task
   board reflects what was actually done once it lands in "Ready to
   Merge":

   ```
   curl -s -X POST http://127.0.0.1:5184/api/tasks/t_1778535809336_f6pjp/append-summary \
     -H "Content-Type: application/json" \
     -d '{"summary":"<1-3 bullet summary of what changed>"}'
   ```

   Keep it concise (1-3 bullet points). This appends the summary beneath
   the original description — both remain visible on the task board.

5. End the session normally. Lattice's Stop hook will verify the commit and move this task to "Ready to Merge" automatically.

Please do not start, stop, or restart any dev servers — the user runs
them in their own console and your output goes to the worktree's terminal.
