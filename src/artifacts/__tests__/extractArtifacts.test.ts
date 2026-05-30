import { describe, it, expect } from 'vitest';
import { extractArtifacts } from '../extractArtifacts';
import { ARTIFACT_TOOL_NAME } from '../../reservedIds';
import type { Message } from '../../types';

function artifactToolMessage(id: string, input: Record<string, unknown>): Message {
  return {
    id,
    role: 'tool',
    text: '',
    toolCall: { id, name: ARTIFACT_TOOL_NAME, input },
  };
}

describe('extractArtifacts', () => {
  it('keeps the prior title when a streaming delta arrives with an empty title', () => {
    const messages: Message[] = [
      artifactToolMessage('a1', {
        id: 'snake',
        title: 'Snake game',
        kind: 'code',
        content: 'console.log("snake");',
      }),
      // Mid-stream delta: model has emitted the next __artifact call but the
      // streamed title/content haven't accumulated yet.
      artifactToolMessage('a2', {
        id: 'snake',
        title: '',
        kind: 'code',
        content: '',
      }),
    ];

    const [artifact] = extractArtifacts(messages);
    expect(artifact.title).toBe('Snake game');
    expect(artifact.kind).toBe('code');
    expect(artifact.versions).toHaveLength(2);
    // The version itself reflects whatever was streamed (so the panel can
    // still show the partial content); only the registry-level title is
    // sticky.
    expect(artifact.versions[1].title).toBe('');
    expect(artifact.versions[1].content).toBe('');
  });

  it('overwrites the title and kind once the next version settles with non-empty content', () => {
    const messages: Message[] = [
      artifactToolMessage('a1', {
        id: 'snake',
        title: 'Snake game',
        kind: 'code',
        content: 'console.log("snake");',
      }),
      artifactToolMessage('a2', {
        id: 'snake',
        title: 'Snake game v2',
        kind: 'react',
        content: 'export default () => null;',
      }),
    ];

    const [artifact] = extractArtifacts(messages);
    expect(artifact.title).toBe('Snake game v2');
    expect(artifact.kind).toBe('react');
    expect(artifact.versions).toHaveLength(2);
  });

  it('ignores a whitespace-only title delta', () => {
    const messages: Message[] = [
      artifactToolMessage('a1', {
        id: 'snake',
        title: 'Snake game',
        kind: 'code',
        content: 'console.log("snake");',
      }),
      artifactToolMessage('a2', {
        id: 'snake',
        title: '   ',
        kind: 'code',
        content: 'console.log("snake v2");',
      }),
    ];

    const [artifact] = extractArtifacts(messages);
    expect(artifact.title).toBe('Snake game');
  });
});
