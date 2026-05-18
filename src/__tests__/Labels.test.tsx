import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../components/ChatInput';
import { ChatWindow } from '../components/ChatWindow';
import { ConversationList } from '../components/ConversationList';
import { ToolCallBlock } from '../components/ToolCallBlock';
import { Chorus } from '../Chorus';
import {
  DEFAULT_CHORUS_LABELS,
  resolveChorusLabels,
  type ChorusComposerLabels,
  type ChorusConversationListLabels,
  type ChorusLabels,
} from '../labels';
import type { ConversationSummary } from '../hooks/useConversations';
import type { Message } from '../types';

vi.mock('../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
  normalizeStreamingMarkdown: (s: string) => s,
}));

const FR_LABELS: ChorusLabels = {
  composer: {
    placeholder: 'Écrivez un message',
    ariaLabel: 'Champ de message',
    attachFile: 'Joindre un fichier',
    send: 'Envoyer',
    stop: 'Arrêter',
    disabledReason: 'Composer désactivé.',
    readOnlyReason: 'Composer en lecture seule.',
  },
  transcript: {
    ariaLabel: 'Historique de chat',
    typing: "L'assistant écrit",
    retry: 'Réessayer',
    jumpToLatest: '↓ Aller au plus récent',
    suggestedPromptsAriaLabel: 'Suggestions',
    emptyStateTitle: 'Comment puis-je aider ?',
  },
  messageActions: {
    edit: 'Modifier',
    regenerate: 'Régénérer',
    copy: 'Copier',
    copyFailed: 'Échec de la copie',
    thumbsUp: "J'aime",
    thumbsDown: "Je n'aime pas",
    delete: 'Supprimer',
    save: 'Enregistrer',
    cancel: 'Annuler',
    editTextareaAriaLabel: 'Modifier le message',
  },
  speakers: {
    user: 'Message utilisateur',
    assistant: "Message de l'assistant",
    system: 'Message système',
    tool: 'Message outil',
  },
  toolCall: {
    input: 'Entrée',
    output: 'Sortie',
  },
  reasoning: 'Raisonnement',
  codeCopy: {
    copy: 'Copier',
    copied: 'Copié !',
    failed: 'Échec',
    ariaLabel: 'Copier le code',
  },
  conversationList: {
    newConversation: 'Nouvelle conversation',
    empty: 'Aucune conversation',
    pin: 'Épingler',
    unpin: 'Désépingler',
    rename: 'Renommer',
    delete: 'Supprimer',
    save: 'Enregistrer',
    cancel: 'Annuler',
    navAriaLabel: 'Conversations',
    renameAriaLabel: (title: string) => `Renommer ${title}`,
    pinAriaLabel: (title: string, pinned: boolean) => `${pinned ? 'Désépingler' : 'Épingler'} ${title}`,
    deleteAriaLabel: (title: string) => `Supprimer ${title}`,
  },
  clearConversation: 'Effacer la conversation',
};

describe('resolveChorusLabels', () => {
  it('returns defaults when no overrides are passed', () => {
    expect(resolveChorusLabels()).toBe(DEFAULT_CHORUS_LABELS);
  });

  it('deep-merges partial overrides without mutating defaults', () => {
    const resolved = resolveChorusLabels({
      composer: { send: 'Send now' },
      transcript: { typing: 'Thinking…' },
    });

    expect(resolved.composer.send).toBe('Send now');
    expect(resolved.composer.attachFile).toBe(DEFAULT_CHORUS_LABELS.composer.attachFile);
    expect(resolved.transcript.typing).toBe('Thinking…');
    expect(resolved.transcript.ariaLabel).toBe(DEFAULT_CHORUS_LABELS.transcript.ariaLabel);
    expect(DEFAULT_CHORUS_LABELS.composer.send).toBe('Send');
  });

  it('treats explicit undefined overrides as "keep the default"', () => {
    const overrides: { composer: Partial<ChorusComposerLabels> } = {
      composer: { send: undefined, stop: 'Halt' },
    };
    const resolved = resolveChorusLabels(overrides);
    expect(resolved.composer.send).toBe(DEFAULT_CHORUS_LABELS.composer.send);
    expect(resolved.composer.stop).toBe('Halt');
  });

  describe('partial override resilience', () => {
    it('treats null section keys as "keep the default" without erasing labels', () => {
      // Cast through unknown because the public type bans `null` at the slot level, but real-world
      // i18n catalogs sometimes emit it for missing translations — the resolver must still ignore it.
      const overrides = {
        composer: { send: null, stop: 'Halt' },
        reasoning: null,
        clearConversation: null,
      } as unknown as ChorusLabels;
      const resolved = resolveChorusLabels(overrides);
      expect(resolved.composer.send).toBe(DEFAULT_CHORUS_LABELS.composer.send);
      expect(resolved.composer.stop).toBe('Halt');
      expect(resolved.reasoning).toBe(DEFAULT_CHORUS_LABELS.reasoning);
      expect(resolved.clearConversation).toBe(DEFAULT_CHORUS_LABELS.clearConversation);
    });

    it('treats empty-string overrides as "keep the default" — both nested and top-level', () => {
      const resolved = resolveChorusLabels({
        composer: { send: '', stop: '', attachFile: 'Joindre' },
        transcript: { typing: '', retry: 'Réessayer' },
        messageActions: { copy: '' },
        speakers: { user: '' },
        toolCall: { input: '' },
        codeCopy: { copy: '' },
        conversationList: { newConversation: '' },
        attachments: { dismissError: '', describeImage: 'Décrire' },
        reasoning: '',
        clearConversation: '',
      });
      expect(resolved.composer.send).toBe(DEFAULT_CHORUS_LABELS.composer.send);
      expect(resolved.composer.stop).toBe(DEFAULT_CHORUS_LABELS.composer.stop);
      expect(resolved.composer.attachFile).toBe('Joindre');
      expect(resolved.transcript.typing).toBe(DEFAULT_CHORUS_LABELS.transcript.typing);
      expect(resolved.transcript.retry).toBe('Réessayer');
      expect(resolved.messageActions.copy).toBe(DEFAULT_CHORUS_LABELS.messageActions.copy);
      expect(resolved.speakers.user).toBe(DEFAULT_CHORUS_LABELS.speakers.user);
      expect(resolved.toolCall.input).toBe(DEFAULT_CHORUS_LABELS.toolCall.input);
      expect(resolved.codeCopy.copy).toBe(DEFAULT_CHORUS_LABELS.codeCopy.copy);
      expect(resolved.conversationList.newConversation).toBe(DEFAULT_CHORUS_LABELS.conversationList.newConversation);
      expect(resolved.attachments.dismissError).toBe(DEFAULT_CHORUS_LABELS.attachments.dismissError);
      expect(resolved.attachments.describeImage).toBe('Décrire');
      expect(resolved.reasoning).toBe(DEFAULT_CHORUS_LABELS.reasoning);
      expect(resolved.clearConversation).toBe(DEFAULT_CHORUS_LABELS.clearConversation);
    });

    it('lets meaningful overrides win while preserving other keys in the same section', () => {
      const resolved = resolveChorusLabels({
        composer: { send: 'Envoyer', stop: '' },
        attachments: {
          completedAnnouncement: (name) => `${name} prêt`,
          dismissError: 'Fermer',
        },
      });
      expect(resolved.composer.send).toBe('Envoyer');
      expect(resolved.composer.stop).toBe(DEFAULT_CHORUS_LABELS.composer.stop);
      expect(resolved.composer.placeholder).toBe(DEFAULT_CHORUS_LABELS.composer.placeholder);
      expect(resolved.attachments.completedAnnouncement('photo.png')).toBe('photo.png prêt');
      expect(resolved.attachments.dismissError).toBe('Fermer');
      expect(resolved.attachments.readingStatus).toBe(DEFAULT_CHORUS_LABELS.attachments.readingStatus);
    });
  });

  describe('attachment label defaults', () => {
    it('formats validation messages with name/accept/size/count interpolation', () => {
      const a = DEFAULT_CHORUS_LABELS.attachments;
      expect(a.unsupportedTypeError({ name: 'notes.txt', accept: 'image/*' }))
        .toBe('notes.txt is not an accepted attachment type (image/*).');
      expect(a.unsupportedTypeError({ name: 'notes.txt' }))
        .toBe('notes.txt is not an accepted attachment type.');
      expect(a.tooLargeError({ name: 'big.png', size: '10 MB', limit: '2 MB' }))
        .toBe('big.png is 10 MB; the limit is 2 MB.');
      expect(a.tooManyError({ name: 'extra.png', max: 1 }))
        .toBe('Only 1 attachment allowed. Remove an attachment before adding extra.png.');
      expect(a.tooManyError({ name: 'extra.png', max: 3 }))
        .toBe('Only 3 attachments allowed. Remove an attachment before adding extra.png.');
      expect(a.readFailedError({ name: 'broken.png', detail: 'disk unavailable' }))
        .toBe('broken.png could not be read: disk unavailable');
      expect(a.uploadFailedError({ name: 'broken.png', detail: 'network down' }))
        .toBe('broken.png could not be uploaded: network down');
      expect(a.imageFallbackAlt('photo.png')).toBe('Attached image: photo.png');
    });
  });
});

describe('ChatInput labels', () => {
  it('uses the provided placeholder/aria-label/title strings for visible affordances', () => {
    render(
      <ChatInput
        value=""
        onChange={() => undefined}
        onSend={() => undefined}
        accept="*"
        labels={FR_LABELS.composer as ChorusComposerLabels}
      />,
    );

    expect(screen.getByPlaceholderText('Écrivez un message')).toBeInTheDocument();
    const textarea = screen.getByRole('textbox', { name: 'Champ de message' });
    expect(textarea).toBeInTheDocument();
    const attach = screen.getByRole('button', { name: 'Joindre un fichier' });
    expect(attach).toHaveAttribute('title', 'Joindre un fichier');
    const send = screen.getByRole('button', { name: 'Envoyer' });
    expect(send).toHaveAttribute('title', 'Envoyer');
  });

  it('swaps send → stop labels while sending', () => {
    render(
      <ChatInput
        value="hi"
        onChange={() => undefined}
        onSend={() => undefined}
        onStop={() => undefined}
        sending
        labels={FR_LABELS.composer as ChorusComposerLabels}
      />,
    );

    const stop = screen.getByRole('button', { name: 'Arrêter' });
    expect(stop).toHaveAttribute('title', 'Arrêter');
  });

  it('falls back to localized read-only/disabled reasons when no explicit disabledReason is set', () => {
    const { rerender } = render(
      <ChatInput
        value=""
        onChange={() => undefined}
        onSend={() => undefined}
        readOnly
        labels={FR_LABELS.composer as ChorusComposerLabels}
      />,
    );

    expect(screen.getByPlaceholderText('Composer en lecture seule.')).toBeInTheDocument();

    rerender(
      <ChatInput
        value=""
        onChange={() => undefined}
        onSend={() => undefined}
        disabled
        labels={FR_LABELS.composer as ChorusComposerLabels}
      />,
    );

    expect(screen.getByPlaceholderText('Composer désactivé.')).toBeInTheDocument();
  });
});

describe('ChatWindow labels', () => {
  const USER_MSG: Message = { id: 'u1', role: 'user', text: 'Bonjour' };
  const ASST_MSG: Message = { id: 'a1', role: 'assistant', text: 'Salut' };
  const TOOL_MSG: Message = {
    id: 't1',
    role: 'tool',
    text: '',
    toolCall: { name: 'search', input: { q: 'rc' }, output: 'ok' },
  };

  it('propagates transcript aria-label and typing status text', () => {
    render(<ChatWindow messages={[USER_MSG]} typing labels={FR_LABELS} />);

    expect(screen.getByRole('log', { name: 'Historique de chat' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: "L'assistant écrit" })).toBeInTheDocument();
  });

  it('renders the localized retry button text', () => {
    const onRetry = vi.fn();
    render(<ChatWindow messages={[USER_MSG]} error="boom" onRetry={onRetry} labels={FR_LABELS} />);

    const retry = screen.getByRole('button', { name: 'Réessayer' });
    expect(retry).toHaveTextContent('Réessayer');
  });

  it('uses localized labels for message actions and speaker SR text', () => {
    render(
      <ChatWindow
        messages={[USER_MSG, ASST_MSG]}
        onEdit={() => undefined}
        onRegenerate={() => undefined}
        onDelete={() => undefined}
        onFeedback={() => undefined}
        labels={FR_LABELS}
      />,
    );

    expect(screen.getByRole('button', { name: 'Modifier' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Régénérer' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Supprimer' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: "J'aime" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: "Je n'aime pas" }).length).toBeGreaterThan(0);
    expect(screen.getByText('Message utilisateur')).toHaveClass('chorus-sr-only');
    expect(screen.getByText("Message de l'assistant")).toHaveClass('chorus-sr-only');
  });

  it('renders the localized empty-state title and suggested-prompts aria-label', () => {
    render(
      <ChatWindow
        messages={[]}
        suggestedPrompts={['Hello']}
        onSuggestedPrompt={() => undefined}
        labels={FR_LABELS}
      />,
    );

    expect(screen.getByText('Comment puis-je aider ?')).toBeInTheDocument();
    expect(screen.getByLabelText('Suggestions')).toBeInTheDocument();
  });

  it('renders localized tool-call section headers when tool messages are visible', async () => {
    const user = userEvent.setup();
    render(
      <ChatWindow messages={[TOOL_MSG]} hiddenRoles={[]} labels={FR_LABELS} />,
    );
    const toggle = screen.getByRole('button', { name: /search/ });
    await user.click(toggle);
    expect(screen.getByText('Entrée')).toBeInTheDocument();
    expect(screen.getByText('Sortie')).toBeInTheDocument();
  });

  it('flashes the localized "copy failed" label when a copy override returns false', async () => {
    const user = userEvent.setup();
    render(
      <ChatWindow messages={[ASST_MSG]} onCopy={() => false} labels={FR_LABELS} />,
    );

    const copy = screen.getByRole('button', { name: 'Copier' });
    await user.click(copy);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Échec de la copie' })).toHaveTextContent('Échec de la copie');
    });
  });
});

describe('ConversationList labels', () => {
  const NOW = '2026-05-16T00:00:00.000Z';
  const conversations: ConversationSummary[] = [
    { id: 'c1', title: 'Hello', createdAt: NOW, updatedAt: NOW, pinned: false },
    { id: 'c2', title: 'World', createdAt: NOW, updatedAt: NOW, pinned: true },
  ];

  it('uses localized list labels for new/empty/pin/unpin/rename/delete affordances', () => {
    render(
      <ConversationList
        conversations={conversations}
        activeId="c1"
        createConversation={() => undefined}
        renameConversation={() => undefined}
        deleteConversation={() => undefined}
        pinConversation={() => undefined}
        labels={FR_LABELS.conversationList as ChorusConversationListLabels}
      />,
    );

    expect(screen.getByRole('navigation', { name: 'Conversations' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nouvelle conversation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Épingler Hello' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Désépingler World' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Renommer Hello' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Supprimer Hello' })).toBeInTheDocument();
  });

  it('renders the localized empty-list message when there are no conversations', () => {
    render(
      <ConversationList
        conversations={[]}
        labels={FR_LABELS.conversationList as ChorusConversationListLabels}
      />,
    );
    expect(screen.getByText('Aucune conversation')).toBeInTheDocument();
  });

  it('keeps the legacy newConversationLabel/emptyLabel overrides taking precedence over labels.*', () => {
    render(
      <ConversationList
        conversations={[]}
        createConversation={() => undefined}
        newConversationLabel="Begin"
        emptyLabel="Nothing here"
        labels={FR_LABELS.conversationList as ChorusConversationListLabels}
      />,
    );
    expect(screen.getByRole('button', { name: 'Begin' })).toBeInTheDocument();
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });
});

describe('ToolCallBlock labels', () => {
  it('uses the provided section headers when expanded', async () => {
    const user = userEvent.setup();
    render(
      <ToolCallBlock
        toolCall={{ name: 'search', input: { q: 'rc' }, output: { hits: 1 } }}
        labels={{ input: 'Entrée', output: 'Sortie' }}
      />,
    );
    await user.click(screen.getByRole('button', { name: /search/ }));
    expect(screen.getByText('Entrée')).toBeInTheDocument();
    expect(screen.getByText('Sortie')).toBeInTheDocument();
  });
});

describe('Chorus integration with labels', () => {
  it('passes labels down to ChatInput placeholder, ChatWindow aria-label, and clear button', () => {
    render(
      <Chorus<Record<string, unknown>>
        showClearButton
        initialMessages={[{ id: 'u1', role: 'user', text: 'Bonjour' }]}
        labels={FR_LABELS}
      />,
    );

    expect(screen.getByPlaceholderText('Écrivez un message')).toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'Historique de chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Effacer la conversation' })).toBeInTheDocument();
  });

  it('still lets the existing `clearLabel` prop override labels.clearConversation', () => {
    render(
      <Chorus showClearButton clearLabel="Wipe it" labels={FR_LABELS} />,
    );
    expect(screen.getByRole('button', { name: 'Wipe it' })).toBeInTheDocument();
  });
});
