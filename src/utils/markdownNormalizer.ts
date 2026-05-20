export function normalizeStreamingMarkdown(text: string) {
  let out = text;
  const patchFence = (fence: '```' | '~~~') => {
    // GFM fences are only valid at the start of a line (CommonMark allows
    // 0–3 leading spaces, but treating "start of line" as column 0 covers
    // every fence written by `marked` itself and avoids inline-backtick
    // false positives like "use ``` on its own line").
    const isAtLineStart = (pos: number) => pos === 0 || out[pos - 1] === '\n';
    let count = 0, i = 0;
    while (true) {
      const pos = out.indexOf(fence, i);
      if (pos === -1) break;
      if (isAtLineStart(pos)) count++;
      i = pos + fence.length;
    }
    // Reuse the existing trailing newline when present so we emit `\n```
    // rather than `\n\n``` — a doubled newline ends the preceding block and
    // renders as a visible blank line that the streaming view never shows.
    if (count % 2 === 1) out += out.endsWith('\n') ? fence : `\n${fence}`;
  };
  patchFence('```'); patchFence('~~~');
  return out;
}
