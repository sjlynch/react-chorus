import React from 'react';
import { Chorus } from '../../Chorus';
import type { ChorusTransformRequest, ConversationMetadata, Message, MessageSpeaker } from '../..';
import { DEMO_PALETTE } from './palettes';
import { mockRoleplayTransport } from './roleplayTransport';

const PERSISTENCE_KEY = 'react-chorus-pg:roleplay';

interface RoleplayCharacter extends MessageSpeaker {
  systemSnippet: string;
}

const CHARACTERS: Record<string, RoleplayCharacter> = {
  hook: {
    id: 'hook',
    name: 'Captain Hook',
    avatarUrl: 'https://api.dicebear.com/9.x/big-smile/svg?seed=hook&backgroundColor=4f46e5',
    systemSnippet: 'Speak as Captain Hook, a vain pirate captain with a hook for a hand. Use florid, archaic phrasing.',
  },
  smee: {
    id: 'smee',
    name: 'Mr. Smee',
    avatarUrl: 'https://api.dicebear.com/9.x/big-smile/svg?seed=smee&backgroundColor=059669',
    systemSnippet: "Speak as Mr. Smee, the captain's anxious, well-meaning first mate. Short sentences, a little stammery.",
  },
};

const PERSONA: MessageSpeaker = {
  id: 'wendy',
  name: 'Wendy',
  avatarUrl: 'https://api.dicebear.com/9.x/big-smile/svg?seed=wendy&backgroundColor=fde68a',
};

interface LoreEntry {
  keys: string[];
  content: string;
}

const LORE: LoreEntry[] = [
  { keys: ['kraken', 'sea monster'], content: 'WORLD LORE — Kraken: A giant cephalopod feared by all sailors. The captain fears it more than he admits.' },
  { keys: ['tinkerbell', 'tinker bell', 'fairy'], content: 'WORLD LORE — Tinker Bell: A pixie loyal to Peter Pan. Mentioning her makes the captain sneer.' },
  { keys: ['neverland', 'lost boys'], content: 'WORLD LORE — Neverland: An island where children do not age.' },
  { keys: ['crocodile', 'tick tock'], content: 'WORLD LORE — The Crocodile: A massive crocodile hunting the captain. He pales at the sound of ticking.' },
];

function activateLore(messages: Message[]): LoreEntry[] {
  const recent = messages.filter(m => m.role === 'user').slice(-2).map(m => m.text.toLowerCase()).join('\n');
  if (!recent) return [];
  const out: LoreEntry[] = [];
  for (const entry of LORE) {
    if (entry.keys.some(k => recent.includes(k))) out.push(entry);
    if (out.length >= 3) break;
  }
  return out;
}

interface RoleplayMeta extends ConversationMetadata {
  characterId?: string;
}

const SUGGESTED_PROMPTS = [
  'Tell me about the kraken.',
  'Have you seen Tinker Bell lately?',
  'Did you hear that ticking?',
  'What should we do about Neverland?',
];

export function RoleplayTab() {
  const [meta, setMeta] = React.useState<RoleplayMeta>({ characterId: 'hook' });
  const character = CHARACTERS[meta.characterId ?? 'hook'] ?? CHARACTERS.hook!;
  const characterRef = React.useRef(character);
  characterRef.current = character;

  const [messages, setMessages] = React.useState<Message[]>([]);
  const handleChange = React.useCallback((next: Message[]) => {
    const lastIndex = next.length - 1;
    setMessages(next.map((m, i) => {
      if (m.speaker) return m;
      if (i !== lastIndex) return m;
      if (m.role === 'user') return { ...m, speaker: PERSONA };
      if (m.role === 'assistant') return { ...m, speaker: characterRef.current };
      return m;
    }));
  }, []);

  const transformRequest = React.useCallback<ChorusTransformRequest>(({ messages: history, systemPrompt: existing }) => {
    const active = characterRef.current;
    const base = [
      `You are playing the role of ${active.name}.`,
      active.systemSnippet,
      `The user's persona is ${PERSONA.name}. Address her by name when natural.`,
    ];
    if (existing) base.push(existing);
    const lore = activateLore(history);
    if (lore.length) base.push('', '— Relevant world lore —', ...lore.map(l => l.content));
    return { systemPrompt: base.join('\n') };
  }, []);

  return (
    <div className="pg-tab-stack">
      <aside className="pg-tab-intro">
        Pick a character below — the next assistant turn streams as that character, with the avatar and name attached via <code>MessageSpeaker</code> and rendered through <code>showSpeakerAvatars</code>. Each send runs <code>transformRequest</code>: it builds a per-turn system prompt from the active character + persona, then injects any matching <strong>lorebook</strong> entries (try “kraken”, “tinker bell”, “crocodile”). Your active-character pick is persisted in <code>conversationMetadata</code> at <code>${PERSISTENCE_KEY}::meta</code>; refresh and it survives.
      </aside>

      <aside className="pg-tab-toolbar">
        <span className="pg-tab-toolbar-label">Persona</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <img src={PERSONA.avatarUrl} alt="" width={20} height={20} style={{ borderRadius: 9999 }} />
          {PERSONA.name}
        </span>
        <span className="pg-tab-toolbar-label" style={{ marginLeft: 12 }}>Character</span>
        <select
          value={character.id}
          onChange={(e) => setMeta((prev) => ({ ...prev, characterId: e.target.value }))}
          style={{ background: '#111827', color: '#f3f4f6', border: '1px solid #374151', borderRadius: 6, padding: '4px 8px' }}
        >
          {Object.values(CHARACTERS).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </aside>

      <Chorus
        value={messages}
        onChange={handleChange}
        transport={mockRoleplayTransport}
        connector="openai"
        transformRequest={transformRequest}
        showSpeakerAvatars
        persistenceKey={PERSISTENCE_KEY}
        conversationMetadata={meta}
        onConversationMetadataChange={(loaded) => setMeta(loaded as RoleplayMeta)}
        suggestedPrompts={SUGGESTED_PROMPTS}
        placeholder={`Address ${character.name}…`}
        showClearButton
        palette={DEMO_PALETTE}
      />
    </div>
  );
}
