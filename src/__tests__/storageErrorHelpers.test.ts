import { describe, expect, it } from 'vitest';
import { createPersistenceError } from '../hooks/persistence/errors';
import { createConversationStorageError } from '../hooks/conversations/storageErrors';

// Regression coverage for the storage-error helpers. They used to mutate the
// caught error in place: `cause` ended up self-referencing when the input was
// already an Error, and assigning `.key` onto a frozen DOMException threw a
// TypeError that masked the real storage failure.
describe('createPersistenceError', () => {
  it('attaches metadata to a fresh Error without mutating the source', () => {
    const source = new Error('disk full');
    const wrapped = createPersistenceError('chat', 'write', source);

    expect(wrapped).not.toBe(source);
    expect(wrapped.key).toBe('chat');
    expect(wrapped.operation).toBe('write');
    expect(wrapped.message).toBe('disk full');
    expect(wrapped.cause).toBe(source);
    // The source error must stay free of storage metadata.
    expect((source as { key?: unknown }).key).toBeUndefined();
    expect((source as { operation?: unknown }).operation).toBeUndefined();
  });

  it('never sets cause to itself and preserves a pre-existing cause', () => {
    const rootCause = new Error('root');
    const source = new Error('outer', { cause: rootCause });
    const wrapped = createPersistenceError('chat', 'read', source);

    expect(wrapped.cause).toBe(source);
    expect(wrapped.cause).not.toBe(wrapped);
    // The original error keeps the cause it was constructed with.
    expect(source.cause).toBe(rootCause);
  });

  it('does not throw or mutate when handed a frozen DOMException', () => {
    const quota = Object.freeze(new DOMException('Full', 'QuotaExceededError'));
    let wrapped: ReturnType<typeof createPersistenceError> | undefined;

    expect(() => { wrapped = createPersistenceError('chat', 'write', quota); }).not.toThrow();
    expect(wrapped?.key).toBe('chat');
    expect(wrapped?.operation).toBe('write');
    expect(wrapped?.name).toBe('QuotaExceededError');
    expect(wrapped?.cause).toBe(quota);
    expect((quota as { key?: unknown }).key).toBeUndefined();
  });

  it('stringifies non-Error inputs and keeps the raw value as cause', () => {
    const wrapped = createPersistenceError('chat', 'deserialize', 'boom');

    expect(wrapped.message).toBe('boom');
    expect(wrapped.cause).toBe('boom');
  });
});

describe('createConversationStorageError', () => {
  it('attaches metadata to a fresh Error without mutating the source', () => {
    const source = new Error('blocked');
    const wrapped = createConversationStorageError('idx', 'read', source, 'conv-1');

    expect(wrapped).not.toBe(source);
    expect(wrapped.key).toBe('idx');
    expect(wrapped.operation).toBe('read');
    expect(wrapped.conversationId).toBe('conv-1');
    expect(wrapped.cause).toBe(source);
    expect((source as { key?: unknown }).key).toBeUndefined();
  });

  it('never sets cause to itself and preserves a pre-existing cause', () => {
    const rootCause = new Error('root');
    const source = new Error('outer', { cause: rootCause });
    const wrapped = createConversationStorageError('idx', 'write', source);

    expect(wrapped.cause).toBe(source);
    expect(wrapped.cause).not.toBe(wrapped);
    expect(source.cause).toBe(rootCause);
  });

  it('does not throw or mutate when handed a frozen DOMException', () => {
    const quota = Object.freeze(new DOMException('Full', 'QuotaExceededError'));
    let wrapped: ReturnType<typeof createConversationStorageError> | undefined;

    expect(() => { wrapped = createConversationStorageError('idx', 'write', quota); }).not.toThrow();
    expect(wrapped?.key).toBe('idx');
    expect(wrapped?.operation).toBe('write');
    expect(wrapped?.cause).toBe(quota);
    expect((quota as { key?: unknown }).key).toBeUndefined();
  });
});
