import { describe, it, expect } from 'vitest';
import { createToolDeltaAccumulator } from '../streaming/toolDeltaAccumulator';

describe('createToolDeltaAccumulator', () => {
  it('clears generated:true after a later chunk supplies a real providerId', () => {
    const accumulate = createToolDeltaAccumulator();
    accumulate({ id: 'tool-1', generated: true, name: 'lookup', provider: 'openai' });
    const merged = accumulate({ id: 'tool-1', providerId: 'call_abc', provider: 'openai' });
    expect(merged.providerId).toBe('call_abc');
    expect(merged.generated).toBe(false);
  });

  it('preserves explicit generated:false from connector chunks', () => {
    const accumulate = createToolDeltaAccumulator();
    accumulate({ id: 'tool-1', generated: true, name: 'lookup', provider: 'openai' });
    const merged = accumulate({ id: 'tool-1', generated: false, providerId: 'call_abc', provider: 'openai' });
    expect(merged.generated).toBe(false);
  });

  it('keeps generated:true when no providerId has arrived yet', () => {
    const accumulate = createToolDeltaAccumulator();
    accumulate({ id: 'tool-1', generated: true, name: 'lookup', provider: 'openai' });
    const merged = accumulate({ id: 'tool-1', input: '{"q":"x"}', provider: 'openai' });
    expect(merged.generated).toBe(true);
  });
});
