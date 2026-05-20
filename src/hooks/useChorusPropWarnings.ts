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
  autoContinueTools: ChorusProps<TMeta>['autoContinueTools'];
  maxToolIterations: ChorusProps<TMeta>['maxToolIterations'];
  shouldContinueToolLoop: ChorusProps<TMeta>['shouldContinueToolLoop'];
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
  autoContinueTools,
  maxToolIterations,
  shouldContinueToolLoop,
}: UseChorusPropWarningsArgs<TMeta>): void {
  React.useEffect(() => {
    if (!isChorusDevMode()) return;

    if (messages !== undefined && onChange) {
      console.warn('[Chorus] `messages` is initial-only and does not make <Chorus> controlled. Use `value` + `onChange` for controlled mode, or rename `messages` to `initialMessages` when you only want to seed uncontrolled state.');
    }

    if (messages !== undefined && initialMessages !== undefined) {
      console.warn('[Chorus] Both `messages` and `initialMessages` were provided. `messages` wins as the initial seed; remove one or the other to avoid ambiguity.');
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

    const toolLoopProps = [
      shouldContinueToolLoop !== undefined && 'shouldContinueToolLoop',
      maxToolIterations !== undefined && 'maxToolIterations',
    ].filter((name): name is string => typeof name === 'string');

    if (toolLoopProps.length > 0) {
      const propList = toolLoopProps.map(name => `\`${name}\``).join(' and ');
      const verb = toolLoopProps.length > 1 ? 'are' : 'is';

      if (!autoContinueTools) {
        console.warn(`[Chorus] ${propList} ${verb} ignored unless \`autoContinueTools\` is enabled. The automatic tool loop only runs when \`autoContinueTools\` is truthy on the \`transport\` send path, so \`shouldContinueToolLoop\` is never invoked and \`maxToolIterations\` is never consulted. Set \`autoContinueTools\`, or remove ${propList}.`);
      }

      if (transport === undefined) {
        console.warn(`[Chorus] ${propList} ${verb} ignored without \`transport\`. The automatic tool loop runs only on the \`transport\` send path; with \`onSend\` you drive tool continuations yourself. Pass \`transport\`, or gate continuations inside your \`onSend\` client.`);
      }
    }
  }, [messages, initialMessages, onChange, value, persistenceKey, connector, transport, onSend, sending, autoContinueTools, maxToolIterations, shouldContinueToolLoop]);
}
