import 'react-chorus/styles.css';
import React from 'react';
import { Chorus, useConversationMetadata } from 'react-chorus';
import type {
  ChorusTransformRequest,
  ConversationMetadata,
  Message,
  MessageSpeaker,
  Transport,
} from 'react-chorus';

// ──────────────────────────────────────────────────────────────────────────────
// 1. Characters and persona — the "data" a downstream roleplay layer would own.
// ──────────────────────────────────────────────────────────────────────────────

interface RoleplayCharacter extends MessageSpeaker {
  /** A snippet appended to the system prompt when this character is active. */
  systemSnippet: string;
}

const CHARACTERS: Record<string, RoleplayCharacter> = {
  hook: {
    id: 'hook',
    name: 'Captain Hook',
    avatarUrl: 'https://api.dicebear.com/9.x/big-smile/svg?seed=hook&backgroundColor=4f46e5',
    systemSnippet: 'Speak as Captain Hook, a vain pirate captain with a hook for a hand. Use florid, archaic phrasing. Address the user by name when you can.',
  },
  smee: {
    id: 'smee',
    name: 'Mr. Smee',
    avatarUrl: 'https://api.dicebear.com/9.x/big-smile/svg?seed=smee&backgroundColor=059669',
    systemSnippet: 'Speak as Mr. Smee, the captain’s anxious and well-meaning first mate. Short sentences, a little stammery, very polite.',
  },
};

const PERSONA: MessageSpeaker = {
  id: 'wendy',
  name: 'Wendy',
  avatarUrl: 'https://api.dicebear.com/9.x/big-smile/svg?seed=wendy&backgroundColor=fde68a',
};

// ──────────────────────────────────────────────────────────────────────────────
// 2. Tiny "lorebook" — keyword-triggered context the layer injects per turn.
//    A real layer would source this from user-authored entries (SillyTavern-
//    style) or a vector store; here it is a hand-written demo.
// ──────────────────────────────────────────────────────────────────────────────

interface LoreEntry {
  /** Lowercased keyword triggers. Any match in the latest user turns activates the entry. */
  keys: string[];
  content: string;
}

const LORE: LoreEntry[] = [
  {
    keys: ['kraken', 'sea monster'],
    content: 'WORLD LORE — Kraken: A giant cephalopod that has dragged three of the captain’s rivals to the depths. The captain fears it more than he admits.',
  },
  {
    keys: ['tinkerbell', 'tinker bell', 'fairy'],
    content: 'WORLD LORE — Tinker Bell: A pixie loyal to Peter Pan. She and the captain have history; mentioning her makes him sneer.',
  },
  {
    keys: ['neverland', 'lost boys'],
    content: 'WORLD LORE — Neverland: An island where children do not age. The Lost Boys live in a hideout beneath an old tree.',
  },
  {
    keys: ['crocodile', 'tick tock'],
    content: 'WORLD LORE — The Crocodile: A massive crocodile that swallowed a ticking clock and is hunting the captain. He pales at the sound of ticking.',
  },
];

// Scan the last two user turns for any lore key. Keep activations stable
// (insertion order, no duplicates) and bounded so the prompt does not blow up
// on a long conversation that mentions everything.
function activateLore(messages: Message[]): LoreEntry[] {
  const recent = messages.filter((m) => m.role === 'user').slice(-2).map((m) => m.text.toLowerCase());
  if (!recent.length) return [];
  const haystack = recent.join('\n');
  const out: LoreEntry[] = [];
  for (const entry of LORE) {
    if (entry.keys.some((k) => haystack.includes(k))) out.push(entry);
    if (out.length >= 3) break;
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. Mock SSE transport — no backend required. The transport reads the system
//    prompt out of history[0] to flavour the response per active character.
// ──────────────────────────────────────────────────────────────────────────────

const sseLine = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
const sseDone = () => 'data: [DONE]\n\n';

function flavourFor(systemPrompt: string, userText: string, characterName: string): string {
  // Read the user's text + the active character's system snippet to pick a tone.
  // This is intentionally cheap — the demo is about the wiring, not the model.
  const lower = userText.toLowerCase();
  const isHook = systemPrompt.includes('Captain Hook');
  if (lower.includes('kraken')) {
    return isHook
      ? `*adjusts his coat* The Kraken? Pah! I have outmaneuvered worse beasts before breakfast. ...You did say the Kraken, did you not, ${characterName ? '' : 'lass'}?`
      : `Oh, the K-Kraken, sir — terrible thing, terrible. Best we not, ah, draw its attention, eh?`;
  }
  if (lower.includes('crocodile') || lower.includes('tick')) {
    return isHook
      ? '*freezes, eyes darting* ...Did you hear that? No? ...Nothing. Carry on.'
      : 'Best n-not mention the crocodile around the captain, if you please. He gets ever so jumpy.';
  }
  if (lower.includes('tinker')) {
    return isHook
      ? 'That insolent firefly? Faugh! She’d sooner sing a duet with the crocodile than aid the likes of me.'
      : 'Pixie business, sir. We try not to meddle with it, on the captain’s orders.';
  }
  return isHook
    ? `*sweeps off his plumed hat and bows* Captain James Hook, at your service. You said: "${userText}". Pray, what would you have me do about it?`
    : `Aye, ${characterName || 'miss'}, you wanted to talk about "${userText}"? I’m all ears, I am.`;
}

const mockTransport: Transport = async (text, history, signal) => {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const enqueue = (line: string) => controller.enqueue(encoder.encode(line));
      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

      try {
        const systemPrompt = history[0]?.role === 'system' ? history[0].text : '';
        const lastUser = [...history].reverse().find((m) => m.role === 'user');
        const userText = lastUser?.text ?? text;
        const personaName = lastUser?.speaker?.name ?? '';
        const reply = flavourFor(systemPrompt, userText, personaName);

        for (const token of reply.match(/\S+\s*|\s+/g) ?? [reply]) {
          if (signal.aborted) return;
          await sleep(28);
          enqueue(sseLine({ choices: [{ index: 0, delta: { content: token } }] }));
        }
        enqueue(sseDone());
        controller.close();
      } catch (err) {
        if (!signal.aborted) controller.error(err);
      }
    },
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
};

// ──────────────────────────────────────────────────────────────────────────────
// 4. The app — bridges `conversationMetadata` (active character / persona) to
//    `transformRequest` (lorebook + character system prompt) and tags
//    streaming messages with the right `MessageSpeaker`.
// ──────────────────────────────────────────────────────────────────────────────

const STORAGE = typeof window !== 'undefined' ? window.localStorage : undefined;
const PERSISTENCE_KEY = 'react-chorus-with-roleplay-example';

interface RoleplayMeta extends ConversationMetadata {
  characterId?: string;
}

export default function App() {
  // The persisted slot lives on `<Chorus conversationMetadata>` — Chorus
  // round-trips it under `${persistenceKey}::meta` automatically. We hydrate
  // the initial value via `useConversationMetadata` so the picker reflects the
  // last-used character on reload.
  const initialMeta = useConversationMetadata(`${PERSISTENCE_KEY}::meta`, { storage: STORAGE });
  const [meta, setMeta] = React.useState<RoleplayMeta>({ characterId: 'hook' });
  const hasSyncedRef = React.useRef(false);
  React.useEffect(() => {
    if (!initialMeta.loaded || hasSyncedRef.current) return;
    hasSyncedRef.current = true;
    if (initialMeta.value && typeof initialMeta.value.characterId === 'string') {
      setMeta(initialMeta.value as RoleplayMeta);
    }
  }, [initialMeta.loaded, initialMeta.value]);

  const character = CHARACTERS[meta.characterId ?? 'hook'] ?? CHARACTERS.hook!;

  // Controlled message state. Tagging happens here so each new turn gets the
  // right speaker without the library learning roleplay semantics. The
  // early-return on `m.speaker` keeps streaming chunks cheap — once tagged, a
  // message never re-renders into the mapper.
  const [messages, setMessages] = React.useState<Message[]>([]);
  const characterRef = React.useRef(character);
  characterRef.current = character;

  const handleChange = React.useCallback((next: Message[]) => {
    const lastIndex = next.length - 1;
    const tagged = next.map((m, i) => {
      if (m.speaker) return m;
      if (i !== lastIndex) return m;
      if (m.role === 'user') return { ...m, speaker: PERSONA };
      if (m.role === 'assistant') return { ...m, speaker: characterRef.current };
      return m;
    });
    setMessages(tagged);
  }, []);

  // Pre-send hook: build the system prompt from the active character + the
  // persona, then inject any lorebook entries triggered by the latest user
  // turn. The result is the WIRE history only — the persisted transcript stays
  // clean (just the user and the assistant's reply).
  const transformRequest = React.useCallback<ChorusTransformRequest>(({ messages, systemPrompt: existing }) => {
    const activeChar = characterRef.current;
    const base = [
      `You are playing the role of ${activeChar.name}.`,
      activeChar.systemSnippet,
      `The user’s persona is ${PERSONA.name}. Address her by name when natural.`,
    ];
    if (existing) base.push(existing);
    const lore = activateLore(messages);
    const loreLines = lore.length ? ['', '— Relevant world lore —', ...lore.map((l) => l.content)] : [];
    return { systemPrompt: [...base, ...loreLines].join('\n') };
  }, []);

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #1f2937', background: '#0f1722' }}>
        <strong style={{ fontSize: 13 }}>react-chorus / with-roleplay</strong>
        <span style={{ fontSize: 12, opacity: 0.7 }}>persona:</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <img src={PERSONA.avatarUrl} alt="" width={18} height={18} style={{ borderRadius: 9999 }} />
          {PERSONA.name}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.7 }}>active character:</span>
        <select
          value={character.id}
          onChange={(e) => setMeta((prev) => ({ ...prev, characterId: e.target.value }))}
          style={{ background: '#111827', color: '#f3f4f6', border: '1px solid #374151', borderRadius: 6, padding: '4px 8px', fontSize: 13 }}
        >
          {Object.values(CHARACTERS).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </header>

      <Chorus
        value={messages}
        onChange={handleChange}
        transport={mockTransport}
        connector="openai"
        transformRequest={transformRequest}
        showSpeakerAvatars
        showClearButton
        persistenceKey={PERSISTENCE_KEY}
        persistenceStorage={STORAGE}
        conversationMetadata={meta}
        onConversationMetadataChange={(loaded) => setMeta(loaded as RoleplayMeta)}
        // System prompt is intentionally empty — `transformRequest` builds the
        // full one per turn from the active character + persona + lorebook.
        suggestedPrompts={[
          'Tell me about the kraken.',
          'Have you seen Tinker Bell lately?',
          'Did you hear that ticking?',
          'What should we do about Neverland?',
        ]}
        placeholder={`Address ${character.name}…`}
        errorMessage="The mock transport could not stream that reply. Try again."
      />
    </div>
  );
}
