import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Chorus } from '../Chorus';
import { ChatInput } from '../components/ChatInput';
import { ChorusArtifactPanel } from '../components/ChorusArtifactPanel';
import { ArtifactCard } from '../components/message-row/ArtifactCard';
import { ToolApprovalCard } from '../components/message-row/ToolApprovalCard';
import { CostHeader } from '../chorus-shell/CostHeader';
import { MessageCostChip } from '../components/message-row/cost';
import { ChorusMcpStatus } from '../chorus-shell/ChorusShellChrome';
import { CalendarPicker } from '../blocks/CalendarPicker';
import {
  DEFAULT_CHORUS_LABELS,
  resolveChorusLabels,
  type ChorusComposerLabels,
} from '../labels';
import { sendMessage } from './chorus/testUtils';
import type { Transport } from './chorus/testUtils';
import type { Artifact } from '../types';
import type { McpServerStatus } from '../mcp/types';

vi.mock('../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
  normalizeStreamingMarkdown: (s: string) => s,
}));

describe('resolveChorusLabels — new sections', () => {
  it('exposes English defaults for the cost/artifacts/approval/mcp sections', () => {
    expect(DEFAULT_CHORUS_LABELS.cost.header).toBe('Cost');
    expect(DEFAULT_CHORUS_LABELS.cost.noUsage).toBe('No usage data yet.');
    expect(DEFAULT_CHORUS_LABELS.artifacts.untitled).toBe('Untitled artifact');
    expect(DEFAULT_CHORUS_LABELS.approval.title).toBe('Approval required');
    expect(DEFAULT_CHORUS_LABELS.mcp.reconnect).toBe('Reconnect');
  });

  it('formats the function-shaped defaults', () => {
    const { cost, artifacts, mcp, toolCall } = DEFAULT_CHORUS_LABELS;
    expect(cost.budgetSuffix('$5.00')).toBe('/ $5.00 budget');
    expect(cost.chipAriaLabel({ formatted: '$0.01', approximate: false })).toBe('Cost: $0.01');
    expect(cost.chipAriaLabel({ formatted: '$0.01', approximate: true })).toBe('Cost: $0.01 (approximate)');
    expect(artifacts.panelAriaLabel('Notes')).toBe('Artifact: Notes');
    expect(artifacts.kind('code')).toBe('Code');
    expect(artifacts.kind('document')).toBe('Document');
    expect(artifacts.kind('html')).toBe('HTML');
    expect(artifacts.kind('react')).toBe('React');
    expect(artifacts.reactError('boom')).toBe('React artifact failed to render: boom');
    expect(mcp.status({ name: 'fs', status: 'error' })).toBe('MCP fs: error');
    expect(mcp.errorSuffix('nope')).toBe(' — nope');
    expect(mcp.reconnectingSuffix(3)).toBe(' (reconnecting in 3s)');
    expect(toolCall.calling('search')).toBe('Calling search…');
  });

  it('merges partial overrides for the new sections without touching siblings', () => {
    const resolved = resolveChorusLabels({
      cost: { header: 'Coût' },
      artifacts: { copy: 'Copier' },
      approval: { deny: 'Refuser' },
      mcp: { reconnect: 'Reconnecter' },
    });
    expect(resolved.cost.header).toBe('Coût');
    expect(resolved.cost.noUsage).toBe(DEFAULT_CHORUS_LABELS.cost.noUsage);
    expect(resolved.artifacts.copy).toBe('Copier');
    expect(resolved.artifacts.download).toBe(DEFAULT_CHORUS_LABELS.artifacts.download);
    expect(resolved.approval.deny).toBe('Refuser');
    expect(resolved.approval.allowOnce).toBe(DEFAULT_CHORUS_LABELS.approval.allowOnce);
    expect(resolved.mcp.reconnect).toBe('Reconnecter');
    expect(resolved.mcp.status).toBe(DEFAULT_CHORUS_LABELS.mcp.status);
  });

  it('treats empty-string overrides as "keep the default" in the new sections', () => {
    const resolved = resolveChorusLabels({
      cost: { header: '', noUsage: 'Rien' },
      artifacts: { copy: '' },
      approval: { deny: '' },
      mcp: { reconnect: '' },
    });
    expect(resolved.cost.header).toBe(DEFAULT_CHORUS_LABELS.cost.header);
    expect(resolved.cost.noUsage).toBe('Rien');
    expect(resolved.artifacts.copy).toBe(DEFAULT_CHORUS_LABELS.artifacts.copy);
    expect(resolved.approval.deny).toBe(DEFAULT_CHORUS_LABELS.approval.deny);
    expect(resolved.mcp.reconnect).toBe(DEFAULT_CHORUS_LABELS.mcp.reconnect);
  });
});

describe('CostHeader labels', () => {
  it('renders the localized header label and budget suffix', () => {
    const labels = resolveChorusLabels({
      cost: {
        header: 'Coût',
        budgetSuffix: (b) => `sur ${b} budget`,
      },
    }).cost;
    render(<CostHeader cost={{ total: 1.23, perModel: { 'gpt': 1.23 }, byMessageId: {} }} budget={5} labels={labels} />);
    expect(screen.getByText('Coût')).toBeInTheDocument();
    expect(screen.getByText('sur $5.00 budget')).toBeInTheDocument();
  });

  it('uses the localized "no usage" tooltip when there is no per-model data', () => {
    const labels = resolveChorusLabels({ cost: { noUsage: 'Aucune donnée' } }).cost;
    const { container } = render(<CostHeader cost={{ total: 0, perModel: {}, byMessageId: {} }} labels={labels} />);
    expect(container.querySelector('.chorus-cost-header-total')).toHaveAttribute('title', 'Aucune donnée');
  });
});

describe('MessageCostChip labels', () => {
  it('builds its aria-label from the localized chipAriaLabel', () => {
    const labels = resolveChorusLabels({
      cost: { chipAriaLabel: ({ formatted }) => `Coût ${formatted}` },
    }).cost;
    render(<MessageCostChip cost={{ usd: 0.003, tokens: 412, modelId: 'gpt' }} labels={labels} />);
    expect(screen.getByLabelText(/^Coût /)).toBeInTheDocument();
  });
});

describe('ChorusArtifactPanel labels', () => {
  const artifact: Artifact = {
    id: 'a1',
    kind: 'document',
    title: 'Design doc',
    versions: [
      { id: 'a1', kind: 'document', title: 'Design doc', content: 'v1', version: 1, messageId: 'm1' },
      { id: 'a1', kind: 'document', title: 'Design doc', content: 'v2', version: 2, messageId: 'm2' },
    ],
  };

  it('uses overridden panel/action strings', () => {
    render(
      <ChorusArtifactPanel
        artifacts={[artifact]}
        activeId="a1"
        activeVersion={2}
        onClose={() => undefined}
        onChangeVersion={() => undefined}
        labels={{
          panelAriaLabel: (t) => `Artefact : ${t}`,
          close: 'Fermer le panneau',
          previousVersion: 'Version précédente',
          nextVersion: 'Version suivante',
          diff: 'Différences',
          copy: 'Copier',
          download: 'Télécharger',
          openInNewTab: 'Ouvrir dans un nouvel onglet',
        }}
      />,
    );
    expect(screen.getByRole('complementary', { name: 'Artefact : Design doc' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fermer le panneau' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Version précédente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Version suivante' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Différences' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copier' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Télécharger' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ouvrir dans un nouvel onglet' })).toBeInTheDocument();
  });

  it('falls back to the localized untitled label for a titleless artifact', () => {
    const untitled: Artifact = {
      id: 'a2',
      kind: 'document',
      title: '',
      versions: [{ id: 'a2', kind: 'document', title: '', content: 'x', version: 1, messageId: 'm1' }],
    };
    render(
      <ChorusArtifactPanel
        artifacts={[untitled]}
        activeId="a2"
        activeVersion={1}
        onClose={() => undefined}
        onChangeVersion={() => undefined}
        labels={{ untitled: 'Artefact sans titre' }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Artefact sans titre' })).toBeInTheDocument();
  });
});

describe('ArtifactCard labels', () => {
  it('uses the localized kind, untitled fallback, and open button', () => {
    render(<ArtifactCard id="a1" kind="code" title="" labels={{ untitled: 'Sans titre', kind: () => 'Code source', open: 'Ouvrir' }} />);
    expect(screen.getByText('Sans titre')).toBeInTheDocument();
    expect(screen.getByText('Code source')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ouvrir' })).toBeInTheDocument();
  });

  it('keeps the explicit openLabel prop taking precedence over labels.open', () => {
    render(<ArtifactCard id="a1" kind="code" title="T" openLabel="Voir" labels={{ open: 'Ouvrir' }} />);
    expect(screen.getByRole('button', { name: 'Voir' })).toBeInTheDocument();
  });
});

describe('ToolApprovalCard labels', () => {
  it('renders localized title and decision buttons', () => {
    render(
      <ToolApprovalCard
        toolCall={{ id: 'c1', name: 'delete_file', input: { path: '/x' } }}
        labels={{
          title: 'Approbation requise',
          allowOnce: 'Autoriser une fois',
          allowAlways: 'Toujours autoriser',
          deny: 'Refuser',
        }}
      />,
    );
    expect(screen.getByRole('group', { name: 'Approbation requise' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Autoriser une fois' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toujours autoriser' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refuser' })).toBeInTheDocument();
  });
});

describe('ChorusMcpStatus labels', () => {
  it('renders the localized status line, suffixes, and reconnect button', () => {
    const labels = resolveChorusLabels({
      mcp: {
        status: ({ name, status }) => `Serveur ${name} : ${status}`,
        errorSuffix: (e) => ` (erreur : ${e})`,
        reconnectingSuffix: (s) => ` — reconnexion dans ${s}s`,
        reconnect: 'Reconnecter',
      },
    }).mcp;
    const servers: McpServerStatus[] = [
      { name: 'files', url: 'ws://x', transport: 'ws', status: 'error', error: 'boom', reconnectAttempt: 1, reconnectInMs: 2000 },
    ];
    render(<ChorusMcpStatus servers={servers} reconnect={() => undefined} labels={labels} />);
    expect(screen.getByText(/Serveur files : error \(erreur : boom\) — reconnexion dans 2s/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnecter' })).toBeInTheDocument();
  });
});

describe('ChatInput composer additions', () => {
  const composerLabels = (over: Partial<ChorusComposerLabels>): ChorusComposerLabels => ({
    ...DEFAULT_CHORUS_LABELS.composer,
    ...over,
  });

  it('localizes the slash-command palette aria-label', () => {
    render(
      <ChatInput
        value="/"
        onChange={() => undefined}
        onSend={() => undefined}
        slashCommands={[{ name: '/help', description: 'aide' }]}
        onSlashCommand={() => undefined}
        labels={composerLabels({ slashCommands: 'Commandes' })}
      />,
    );
    expect(screen.getByRole('listbox', { name: 'Commandes' })).toBeInTheDocument();
  });

  it('localizes the MCP resource picker label and placeholder', () => {
    render(
      <ChatInput
        value=""
        onChange={() => undefined}
        onSend={() => undefined}
        resourceAttachments={[{ name: 'doc.md', type: 'text/markdown', data: 'data:text/plain,doc', size: 3 }]}
        labels={composerLabels({ attachResource: 'Joindre une ressource', resourcePickerPlaceholder: 'Ressources' })}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Joindre une ressource' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Ressources' })).toBeInTheDocument();
  });

  it('uses the localized model-picker fallback when the picker supplies no ariaLabel', () => {
    render(
      <ChatInput
        value=""
        onChange={() => undefined}
        onSend={() => undefined}
        modelPicker={{ options: [{ value: 'gpt', label: 'GPT' }], value: 'gpt', onChange: () => undefined }}
        labels={composerLabels({ modelPicker: 'Fournisseur' })}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Fournisseur' })).toBeInTheDocument();
  });
});

describe('CalendarPicker confirmLabel', () => {
  it('uses the localized confirm button label', () => {
    render(<CalendarPicker defaultDate="2026-06-14" confirmLabel="Confirmer" emit={() => undefined} props={{}} streaming={false} />);
    expect(screen.getByRole('button', { name: 'Confirmer' })).toBeInTheDocument();
  });
});

describe('Chorus integration — cost + tool-loader labels', () => {
  it('passes labels.cost through to the conversation cost header', () => {
    render(
      <Chorus
        showCost
        budgetAlert={5}
        initialMessages={[{ id: 'a1', role: 'assistant', text: 'hi' }]}
        labels={{ cost: { header: 'Dépense', budgetSuffix: (b) => `plafond ${b}` } }}
      />,
    );
    expect(screen.getByText('Dépense')).toBeInTheDocument();
    expect(screen.getByText('plafond $5.00')).toBeInTheDocument();
  });

  it('forwards labels.toolCall.calling to the default streaming tool loader', async () => {
    const encoder = new TextEncoder();
    let release!: () => void;
    const open = new Promise<void>(resolve => { release = resolve; });
    const body = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'consult_calendar', arguments: '{"q":"' } }] } }] })}\n\n`));
        await open;
        controller.close();
      },
    });
    const transport = vi.fn<Transport>(async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));

    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(
      <Chorus
        transport={transport}
        connector="openai"
        minAssistantDelayMs={0}
        labels={{ toolCall: { calling: (t) => `Appel de ${t}…` } }}
      />,
    );
    await sendMessage(user, 'consult calendar');

    try {
      await waitFor(() => expect(screen.getByText('Appel de consult_calendar…')).toBeInTheDocument());
    } finally {
      release();
    }
  });
});
