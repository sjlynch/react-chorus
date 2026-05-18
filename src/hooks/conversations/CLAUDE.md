# conversations submodule guide

`useConversations.ts` is the public facade. Keep exported types re-exported there so existing imports remain stable.

## Module map

- `types.ts` — public conversation/result/options/storage error types.
- `storageSource.ts` — default keys/storage resolution, default ID generation, and the first render sync/async index read setup.
- `indexReadLifecycle.ts` — async/sync index reload effect, migration persistence, read-error fallback, and pending pre-load create merging.
- `lifecycle.ts` — unmount, `pagehide`, and hidden-visibility flushing for debounced index writes.
- `crossTabSync.ts` — localStorage `storage` event synchronization for the conversation index.
- `actions.ts` — create/select/rename/rename-from-first-message/delete/pin callbacks and transcript deletion fallback.
- `indexCodec.ts` — index parsing/migration/serialization, active-id selection, timestamps, pending-create merge, and first-message title generation.
- `indexWriteQueue.ts` — debounced/serialized index writes.
- `storageAdapter.ts` — transcript storage wrapper that touches conversation timestamps.
- `storageErrors.ts` — conversation storage error normalization.

## Invariants

- Async storage reads set `loaded: false`; writes are version-gated so stale async reads cannot overwrite newer in-memory changes.
- `createConversation()` before the initial async read resolves must queue against the exact `(storage, indexKey)` source and merge after a successful read; stale-source pending creates are discarded.
- Active IDs always flow through `chooseActiveId()` on commits, while cross-tab reads prefer the current active ID when it still exists in the incoming index.
- Transcript deletion uses `removeItem()` when available and falls back to `setItem(key, '[]')`; failures are reported as `delete` errors while the index entry is still removed.
- Debounced index writes must flush on source changes, unmount, `pagehide`, and hidden `visibilitychange`.
