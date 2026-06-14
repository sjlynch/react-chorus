import type { Message, Transport } from '../..';
import { makeSSEResponse, sseDone, sseLine, sleep, tokenize } from './sseUtils';

const REPLY_TOKEN_DELAY_MS = 24;

interface ReplyContext {
  systemPrompt: string;
  userText: string;
  personaName: string;
}

/**
 * Generate a character-flavoured reply by sniffing the system prompt (the
 * playground roleplay tab pushes the active character into it via
 * `transformRequest`). Intentionally cheap — this demo proves the wiring,
 * not the model.
 */
function flavourFor({ systemPrompt, userText, personaName }: ReplyContext): string {
  const lower = userText.toLowerCase();
  const isHook = systemPrompt.includes('Captain Hook');
  const isLore = (key: string) => lower.includes(key);

  if (isLore('kraken')) {
    return isHook
      ? '*adjusts his coat* The Kraken? Pah! I have outmaneuvered worse beasts before breakfast. ...You did say the Kraken, did you not?'
      : 'Oh, the K-Kraken, sir — terrible thing, terrible. Best we not, ah, draw its attention, eh?';
  }
  if (isLore('crocodile') || isLore('tick')) {
    return isHook
      ? '*freezes, eyes darting* ...Did you hear that? No? ...Nothing. Carry on.'
      : 'Best n-not mention the crocodile around the captain, if you please. He gets ever so jumpy.';
  }
  if (isLore('tinker') || isLore('fairy')) {
    return isHook
      ? 'That insolent firefly? Faugh! She would sooner sing a duet with the crocodile than aid the likes of me.'
      : 'Pixie business, sir. We try not to meddle with it, on the captain’s orders.';
  }
  if (isLore('neverland') || isLore('lost boys')) {
    return isHook
      ? '*twirls his mustache* Neverland, that wretched isle. Were it not for those pestilent boys, we should have weighed anchor a decade ago.'
      : `Neverland, ${personaName || 'miss'}? An island full of mischief if ever there was one.`;
  }
  return isHook
    ? `*sweeps off his plumed hat and bows* Captain James Hook, at your service${personaName ? `, dear ${personaName}` : ''}. You said: "${userText}". Pray, what would you have me do about it?`
    : `Aye, ${personaName || 'miss'}, you wanted to talk about "${userText}"? I'm all ears, I am.`;
}

function findLastUser(history: Message[]): Message | undefined {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i]!;
    if (m.role === 'user') return m;
  }
  return undefined;
}

export const mockRoleplayTransport: Transport = (text, history, signal) => makeSSEResponse(async function* () {
  const systemPrompt = history[0]?.role === 'system' ? history[0].text : '';
  const lastUser = findLastUser(history);
  const userText = lastUser?.text ?? text;
  const personaName = lastUser?.speaker?.name ?? '';
  const reply = flavourFor({ systemPrompt, userText, personaName });

  for (const token of tokenize(reply)) {
    await sleep(REPLY_TOKEN_DELAY_MS, signal);
    yield sseLine({ choices: [{ index: 0, delta: { content: token } }] });
  }
  yield sseDone();
}, signal);
