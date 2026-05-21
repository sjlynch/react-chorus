# conversations submodule guide

`useConversations.ts` is the public facade. Keep exported types re-exported there so existing imports remain stable.

## Module map

- `types.ts` — public conversation/result/options/storage error types.
- `storageSource.ts` — default keys/storage resolution, default ID generation, and the first render sync/async index read setup.
- `indexReadLifecycle.ts` — async/sync index reload effect, migration persistence, read-error fallback, and pending pre-load create merging.
- `lifecycle.ts` — unmount, `pagehide`, and hidden-visibility flushing for debounced index writes.
- `crossTabSync.ts` — localStorage `storage` event synchronization for the conversation index.
- `actions.ts` — create/select/rename/rename-from-first-message/delete/pin callbacks and transcript deletion fallback.
- `indexCodec.ts` — compatibility barrel that re-exports the conversation index helper API for existing internal callers.
- `parse.ts` / `sanitize.ts` — index JSON parse/serialize/state conversion plus summary sanitization, timestamp backfill migration warnings, pinned coercion, and pristine default-title migration.
- `activeId.ts` / `timestamp.ts` / `pendingCreates.ts` / `title.ts` — focused helpers for active-id selection, timestamp normalization, pre-load create merging, and first-message/default-title derivation.
- `indexWriteQueue.ts` — debounced/serialized index writes. Exposes a `writeCoordination` (`isWritePending`/`whenWriteSettles`) so `crossTabSync` can defer external events behind in-flight writes, and an `onWriteSuccess(version)` callback so the facade can clear a stale `error` once a later write lands.
- `storageAdapter.ts` — transcript storage wrapper that touches conversation timestamps.
- `storageErrors.ts` — conversation storage error normalization.

## Invariants

- Async storage reads set `loaded: false`; writes are version-gated so stale async reads cannot overwrite newer in-memory changes.
- `createConversation()` before the initial async read resolves must queue against the exact `(storage, indexKey)` source and merge after a successful read; stale-source pending creates are discarded.
- Active IDs always flow through `chooseActiveId()` on commits, while cross-tab reads prefer the current active ID when it still exists in the incoming index.
- Transcript deletion uses `removeItem()` when available and falls back to `setItem(key, '[]')`; failures are reported as `delete` errors while the index entry is still removed. **Known divergence:** the fallback `setItem(key, '[]')` is the same storage primitive a transcript `write` uses, yet a fallback failure is still reported as `delete`, not `write`. This is intentional — `delete` reflects the host's intent, and (critically) it keeps the error outside `handleIndexWriteSuccess`'s `write`-error clearing. `deleteConversation` issues an index write immediately after the transcript delete; if the fallback failure were classified `write`, that index write's success would silently dismiss it. A host inspecting `error.operation` therefore sees `delete` for both deletion paths, even though one path internally calls `setItem`.
- Debounced index writes must flush on source changes, unmount, `pagehide`, and hidden `visibilitychange`.
- `crossTabSync` must defer an incoming `storage` event behind any in-flight index write (`writeCoordination`) and rebase it against the freshest `stateRef.current` on settle — an external value applied mid-write would be clobbered when the in-flight write persists its stale snapshot.
- `error` is cleared by the read lifecycle, by cross-tab sync, and by `onWriteSuccess` after a successful index write (version-gated). A transient `setItem` failure must not leave `error` populated forever once later writes succeed.
- `storageAdapter` never derives a conversation id from a key equal to `indexKey`; an index write is not a transcript write even when `indexKey` shares the `messageKeyPrefix`.

## Known ordering hazards

- **Transcript delete vs. in-flight message write.** `deleteConversation` calls `removeConversationMessages(id)` on the raw storage, while `<Chorus>` writes that conversation's transcript through the wrapped `conversationStorage` adapter on an independent `useChorusPersistence` write chain. With an async adapter, a debounced/in-flight message `setItem` for the key can be ordered *after* the delete's `removeItem`, resurrecting the deleted transcript key as an orphan (no index entry). There is no shared write coordination between the two chains. Hosts that delete a conversation while its `<Chorus>` is still mounted must unmount that `<Chorus>` (or `flush()` its persistence) before calling `deleteConversation` for that id.
- **Send before the index loads.** While the async index read is pending, `loaded` is false and `activePersistenceKey` is `''`. A message sent in that window mounts `useChorusPersistence('')`, whose `onChange` drops the message silently (it is not even queued as a pending pre-load change). Hosts must gate the composer — disable `<Chorus>` or the send action — on `useConversations().loaded`. See the `loaded` JSDoc in `types.ts`.
- **Pre-load create vs. concurrent remote delete.** A `createConversation()` called before the async index read resolves queues a `PendingConversationCreate`; `mergePendingCreates` re-inserts it into the freshly read index. If a concurrent tab or server sync deleted that same id from the index *after* the local create but *before* the async read resolved, the merge re-adds the deleted id — the pre-load create wins over the remote delete. The window is narrow (the delete must land between the queued create and the read settling), and stale pending creates are already discarded when their `(storage, indexKey)` source no longer matches, but a delete that keeps the same source is not detected. Treat a pre-load `createConversation` as authoritative for ids the host itself just created.
