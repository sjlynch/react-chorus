import React from 'react';
import { isChorusDevMode } from '../utils/devMode';
import type { ChorusProps } from '../Chorus.types';
import type { Message } from '../types';

interface UseChorusPropWarningsArgs<TMeta> {
  messages: Message<TMeta>[] | undefined;
  initialMessages: Message<TMeta>[] | undefined;
  onChange: ChorusProps<TMeta>['onChange'];
  value: Message<TMeta>[] | undefined;
  persistenceKey: string | undefined;
  connector: ChorusProps<TMeta>['connector'];
  transport: ChorusProps<TMeta>['transport'];
  onSend: ChorusProps<TMeta>['onSend'];
  sending: boolean | undefined;
}

export function useChorusPropWarnings<TMeta>({
  messages,
  initialMessages,
  onChange,
  value,
  persistenceKey,
  connector,
  transport,
  onSend,
  sending,
}: UseChorusPropWarningsArgs<TMeta>): void {
  // The message seed (`messages ?? initialMessages`) is captured once at mount
  // by useChorusMessages and never re-derived. Track its mount-time reference so
  // a parent that later swaps the array (locale/theme/persona change) gets a
  // one-time warning instead of a silently ignored update — the seed also backs
  // `resetToInitialMessages`, so the stale value resurfaces on clear().
  const mountSeedRef = React.useRef<Message<TMeta>[] | undefined>(messages ?? initialMessages);
  const seedChangeWarnedRef = React.useRef(false);

  React.useEffect(() => {
    if (!isChorusDevMode()) return;

    if (messages !== undefined && onChange) {
      console.warn('[Chorus] `messages` is initial-only and does not make <Chorus> controlled. Use `value` + `onChange` for controlled mode, or rename `messages` to `initialMessages` when you only want to seed uncontrolled state.');
    }

    if (messages !== undefined && initialMessages !== undefined) {
      console.warn('[Chorus] Both `messages` and `initialMessages` were provided. `messages` wins as the initial seed; remove one or the other to avoid ambiguity.');
    }

    if (!seedChangeWarnedRef.current && (messages ?? initialMessages) !== mountSeedRef.current) {
      seedChangeWarnedRef.current = true;
      const changedProp = messages !== undefined ? 'messages' : 'initialMessages';
      console.warn(`[Chorus] \`${changedProp}\` array reference changed after mount; the new value is ignored because the seed is captured at mount. To replace the transcript, use \`value\`+\`onChange\`, call ChorusRef.clear(), or remount via \`key={...}\`.`);
    }

    if (value !== undefined && persistenceKey) {
      console.warn('[Chorus] Both `value` and `persistenceKey` were provided. `value` makes the message list controlled, so built-in persistence is ignored and message changes are not saved automatically. Remove `persistenceKey` or manage persistence in your controlled state.');
    }

    if (value !== undefined && !onChange) {
      console.warn('[Chorus] `value` makes Chorus controlled, but no `onChange` prop was provided. `onChange` is required for the built-in send/edit/delete/clear UI to update controlled messages.');
    }

    if (connector !== undefined && transport === undefined && onSend) {
      console.warn('[Chorus] `connector` only applies to the `transport` send path. With `onSend` you parse the response yourself — pass `connector` into the `useChorusStream` call inside your `onSend` if you need it.');
    }

    if (sending !== undefined && transport) {
      console.warn('[Chorus] `sending` was provided alongside `transport`. Chorus owns the transport send state; `sending` is primarily for fully custom `onSend`/`useChorusStream` integrations.');
    }
  }, [messages, initialMessages, onChange, value, persistenceKey, connector, transport, onSend, sending]);
}
