import type { Transport } from '../../hooks/useChorusStream';
import { makeSSEResponse, sseDone, streamTextTokens } from './sseUtils';

export interface Citation {
  title: string;
  url: string;
}

const CITATION_BANK: Citation[] = [
  { title: 'React docs — useId', url: 'https://react.dev/reference/react/useId' },
  { title: 'MDN — ReadableStream', url: 'https://developer.mozilla.org/docs/Web/API/ReadableStream' },
  { title: 'OpenAI — Streaming responses', url: 'https://platform.openai.com/docs/api-reference/streaming' },
  { title: 'Anthropic — Server-sent events', url: 'https://docs.anthropic.com/en/api/messages-streaming' },
  { title: 'Google AI — Gemini streaming', url: 'https://ai.google.dev/api/generate-content#method:-models.streamgeneratecontent' },
  { title: 'web.dev — Streams API', url: 'https://web.dev/articles/streams' },
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function citationsForPrompt(prompt: string): Citation[] {
  const h = hashString(prompt);
  const a = CITATION_BANK[h % CITATION_BANK.length];
  const b = CITATION_BANK[(h + 1) % CITATION_BANK.length];
  const c = CITATION_BANK[(h + 3) % CITATION_BANK.length];
  return [a, b, c];
}

const REPLIES = [
  "Here's a quick answer. Chorus's `palette` prop is a thin mapper that writes ~30 CSS custom properties onto the root element — swap the chips on the right to see live theme changes. The bubble below also has a custom citations footer wired up via `renderMessage`.",
  "Citations like the ones below are a great use-case for the `renderMessage` slot. Your callback receives `defaultRender(slots?)` and can pass in `{ footerSlot: <YourFooter /> }` to keep all the default styling while adding new chrome.",
  "Theming is decoupled from rendering: `<ChorusTheme palette={…}>` is a standalone wrapper if you want palette scope without using the full `<Chorus>` widget, and the same CSS variables drive both.",
];

function pickReply(prompt: string): string {
  return REPLIES[hashString(prompt) % REPLIES.length];
}

export const themingTransport: Transport = (text, _history, signal) => {
  const reply = pickReply(text);
  return makeSSEResponse(async function* (sig) {
    yield* streamTextTokens(reply, sig);
    yield sseDone();
  }, signal);
};
