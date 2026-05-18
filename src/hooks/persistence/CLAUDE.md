# Persistence hook internals

- `messageCodec.ts` owns JSON defaults plus the default `Message` validator. Custom `deserializeMessages` callbacks intentionally receive only an array guard after they return; callers that opt in to custom decoding own any deeper validation/revival rules.
- `writeQueue.ts` serializes debounced/immediate writes so async adapters cannot let older saves overwrite newer messages. Keep page-lifecycle flushes on the synchronous fast path when no async write is in flight.
- `readLifecycle.ts` resolves default storage, performs the render-time initial read, and runs follow-up key/storage reads while preserving `loaded`, `hasStoredValue`, and read-error semantics.
- `preloadReplay.ts` is the audit point for pre-load `onChange` replay: replay only when the read succeeds and `getItem()` returned exactly `null`; stored empty/corrupt strings must not be clobbered.
- `localStorageSync.ts` is only for default `window.localStorage` cross-tab `storage` events; custom/async adapters are responsible for their own notifications.
