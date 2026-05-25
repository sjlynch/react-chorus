import type { Transport } from '../../hooks/useChorusStream';
import type { Message } from '../../types';
import { ARTIFACT_TOOL_NAME } from '../../reservedIds';
import { makeOpenAIToolCallChunk } from './openAIChunkBuilders';
import { DEMO_CHUNK_DELAY_MS, makeSSEResponse, sleep, sseDone, sseLine, streamTextTokens } from './sseUtils';

interface ArtifactPlan {
  id: string;
  kind: 'code' | 'document' | 'html';
  title: string;
  content: string;
  language?: string;
  intro: string;
}

const SNAKE_GAME = `<!doctype html>
<html><body style="margin:0;background:#0b0b0d;color:#e7e7ea;font-family:system-ui;display:grid;place-items:center;height:100vh;">
<canvas id="c" width="320" height="320" style="border:1px solid #6366f1;border-radius:12px"></canvas>
<script>
  const ctx = c.getContext('2d');
  let snake = [[10,10]], dir = [1,0], food = [15,10], grow = 0;
  document.addEventListener('keydown', e => {
    const k = { ArrowUp:[0,-1], ArrowDown:[0,1], ArrowLeft:[-1,0], ArrowRight:[1,0] }[e.key];
    if (k && (k[0] !== -dir[0] || k[1] !== -dir[1])) dir = k;
  });
  setInterval(() => {
    const head = [(snake[0][0]+dir[0]+20)%20, (snake[0][1]+dir[1]+20)%20];
    snake.unshift(head);
    if (head[0] === food[0] && head[1] === food[1]) {
      grow += 3;
      food = [Math.floor(Math.random()*20), Math.floor(Math.random()*20)];
    }
    if (grow > 0) grow--; else snake.pop();
    ctx.fillStyle = '#0b0b0d'; ctx.fillRect(0,0,320,320);
    ctx.fillStyle = '#ef4444'; ctx.fillRect(food[0]*16, food[1]*16, 14, 14);
    ctx.fillStyle = '#6366f1'; snake.forEach(s => ctx.fillRect(s[0]*16, s[1]*16, 14, 14));
  }, 120);
</script></body></html>`;

const DEBOUNCE_TS = `export function debounce<T extends (...args: never[]) => unknown>(
  fn: T,
  waitMs: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, waitMs);
  };
}`;

const DEBOUNCE_TS_V2 = `export function debounce<T extends (...args: never[]) => unknown>(
  fn: T,
  waitMs: number,
  options: { leading?: boolean } = {},
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  return (...args: Parameters<T>) => {
    if (options.leading && !pending) fn(...args);
    pending = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      pending = false;
      if (!options.leading) fn(...args);
    }, waitMs);
  };
}`;

const RELEASE_NOTES = `# react-chorus release notes — draft

## Headline
A single \`<Chorus>\` now handles **multi-provider routing**, **per-tool approvals**, **artifacts**, **generative UI blocks**, and a **live cost meter** without giving up the drop-in API.

## Multi-provider routing
Pass a \`providers\` registry to route every turn through a different connector while keeping one transcript. The composer renders a model picker; \`/model:<id>\` switches from the keyboard.

## Tool approvals
Mark a tool \`requiresApproval\` and set \`toolPolicy: { default: 'ask' }\`. The tool row turns into an Allow once / Allow always / Deny gate before the handler runs.

## Artifacts
Long generated code, HTML, or documents arrive as a reserved \`__artifact\` tool call and dock to a side panel with a version switcher. The inline card stays small.

## Generative UI
Register block components in \`blocks\`. The assistant emits \`__render_block\` calls and Chorus mounts your component inline with the (possibly streaming) props.

## Cost meter
\`showCost\` reads \`metadata.usage\` from connector frames, looks up a model in the built-in \`PRICING\` table, and renders a per-bubble chip plus a conversation total. \`budgetAlert\` trips a one-shot callback.
`;

const PLAN_BY_PROMPT: Record<string, ArtifactPlan> = {
  snake: {
    id: 'art-snake',
    kind: 'html',
    title: 'Snake (HTML demo)',
    content: SNAKE_GAME,
    intro: "Here's a tiny canvas-based Snake game. The HTML artifact opens in a sandboxed iframe in the side panel — focus it and use the arrow keys.",
  },
  debounce: {
    id: 'art-debounce',
    kind: 'code',
    title: 'debounce.ts',
    language: 'typescript',
    content: DEBOUNCE_TS,
    intro: "A typed `debounce` helper. The full source ships as a `code` artifact so the inline message stays a short summary while the side panel holds the file.",
  },
  release: {
    id: 'art-release-notes',
    kind: 'document',
    title: 'Release notes (draft)',
    content: RELEASE_NOTES,
    intro: "Draft release notes. Markdown documents render with the same pipeline as transcript messages.",
  },
};

function planForPrompt(text: string): ArtifactPlan | null {
  const lower = text.toLowerCase();
  if (lower.includes('snake')) return PLAN_BY_PROMPT.snake;
  if (lower.includes('debounce')) return PLAN_BY_PROMPT.debounce;
  if (lower.includes('release') || lower.includes('notes')) return PLAN_BY_PROMPT.release;
  if (lower.includes('revise') || lower.includes('add leading') || lower.includes('v2')) {
    return { ...PLAN_BY_PROMPT.debounce, content: DEBOUNCE_TS_V2, intro: "Updated `debounce` with an optional `leading` flag. Same `id` as before, so the panel stacks it as **version 2** with a version switcher." };
  }
  return null;
}

function findExistingArtifactCount(history: Message[], artifactId: string): number {
  let count = 0;
  for (const m of history) {
    if (m.role === 'tool' && m.toolCall?.name === ARTIFACT_TOOL_NAME) {
      const input = m.toolCall.input as { id?: string } | undefined;
      if (input?.id === artifactId) count++;
    }
  }
  return count;
}

export const artifactsTransport: Transport = (text, history, signal) => {
  const plan = planForPrompt(text);
  return makeSSEResponse(async function* (sig) {
    if (!plan) {
      yield* streamTextTokens(
        "Try one of the suggested prompts — each one emits a different artifact kind (HTML, code, or document) via the reserved `__artifact` tool call.",
        sig,
      );
      yield sseDone();
      return;
    }

    yield* streamTextTokens(plan.intro, sig);
    await sleep(DEMO_CHUNK_DELAY_MS * 3, sig);

    const existingVersions = findExistingArtifactCount(history, plan.id);
    const versionLabel = existingVersions > 0 ? ` (v${existingVersions + 1})` : '';

    yield sseLine(makeOpenAIToolCallChunk({
      id: `call_artifact_${plan.id}_${Date.now()}`,
      name: ARTIFACT_TOOL_NAME,
      input: {
        id: plan.id,
        kind: plan.kind,
        title: plan.title + versionLabel,
        content: plan.content,
        ...(plan.language ? { language: plan.language } : {}),
      },
    }, 0));

    yield sseDone();
  }, signal);
};
