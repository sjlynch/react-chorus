# Missing: Gemini connector (Google AI / Vertex AI streaming format)

Only OpenAI and Anthropic connectors exist. Google Gemini's streaming format is:
  data: {"candidates":[{"content":{"parts":[{"text":"..."}]}}]}

The autoConnector will not extract text from this format correctly since it keys on obj.choices (OpenAI) and obj.type (Anthropic).

Add src/connectors/gemini.ts, register it in getConnector('gemini'), and add to autoConnector detection. Include usage example in README.

---

**Lattice task ID:** `t_1778509916195_z2gm5`
**Created:** 2026-05-11T14:31:56.195Z

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
   curl -s -X POST http://127.0.0.1:5184/api/tasks/t_1778509916195_z2gm5/append-summary \
     -H "Content-Type: application/json" \
     -d '{"summary":"<1-3 bullet summary of what changed>"}'
   ```

   Keep it concise (1-3 bullet points). This appends the summary beneath
   the original description — both remain visible on the task board.

5. End the session normally. Lattice's Stop hook will verify the commit and move this task to "Ready to Merge" automatically.

Please do not start, stop, or restart any dev servers — the user runs
them in their own console and your output goes to the worktree's terminal.
