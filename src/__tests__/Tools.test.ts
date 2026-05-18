import { describe, it, expect } from 'vitest';
import { toToolDefinitionList } from '../tools';
import type { ChorusToolDefinition, ChorusToolRegistry } from '../tools';

describe('toToolDefinitionList', () => {
  it('skips record entries whose key is empty', () => {
    const handler = () => null;
    const registry: ChorusToolRegistry = {
      '': { handler, description: 'should be dropped' },
      ok: { handler, description: 'kept' },
    };
    const list = toToolDefinitionList(registry);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('ok');
  });

  it('skips array entries whose name is empty', () => {
    const handler = () => null;
    const registry: ChorusToolDefinition[] = [
      { name: '', handler },
      { name: 'ok', handler },
    ];
    const list = toToolDefinitionList(registry);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('ok');
  });
});
