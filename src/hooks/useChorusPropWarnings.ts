import React from 'react';
import { isChorusDevMode } from '../utils/devMode';
import { isTransportPresent } from './assistant-session/transportResolver';
import type { ChorusProps } from '../Chorus.types';
import type { Message } from '../types';

interface UseChorusPropWarningsArgs<TMeta> {
  messages: Message<TMeta>[] | undefined;
  initialMessages: Message<TMeta>[] | undefined;
  onChange: ChorusProps<TMeta>['onChange'];
  value: Message<TMeta>[] | undefined;
  persistenceKey: string | undefined;
  connector: ChorusProps<TMeta>['connector'];
  connectorOptions: ChorusProps<TMeta>['connectorOptions'];
  transport: ChorusProps<TMeta>['transport'];
  onSend: ChorusProps<TMeta>['onSend'];
  onStreamDone: ChorusProps<TMeta>['onStreamDone'];
  showCost: ChorusProps<TMeta>['showCost'];
  sending: boolean | undefined;
  autoContinueTools: ChorusProps<TMeta>['autoContinueTools'];
  maxToolIterations: ChorusProps<TMeta>['maxToolIterations'];
  shouldContinueToolLoop: ChorusProps<TMeta>['shouldContinueToolLoop'];
  tools: ChorusProps<TMeta>['tools'];
  onToolCall: ChorusProps<TMeta>['onToolCall'];
  onToolDelta: ChorusProps<TMeta>['onToolDelta'];
  continueOnToolError: ChorusProps<TMeta>['continueOnToolError'];
}

export function useChorusPropWarnings<TMeta>({
  messages,
  initialMessages,
  onChange,
  value,
  persistenceKey,
  connector,
  connectorOptions,
  transport,
  onSend,
  onStreamDone,
  showCost,
  sending,
  autoContinueTools,
  maxToolIterations,
  shouldContinueToolLoop,
  tools,
  onToolCall,
  onToolDelta,
  continueOnToolError,
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

    if (value !== undefined && (messages !== undefined || initialMessages !== undefined)) {
      const seedProp = messages !== undefined ? 'messages' : 'initialMessages';
      console.warn(`[Chorus] Both \`value\` and \`${seedProp}\` were provided. \`value\` makes the message list controlled, so \`${seedProp}\` does not seed what is displayed — it only backs the uncontrolled state restored by \`resetToInitialMessages\` on clear(). Remove \`${seedProp}\`, or drop \`value\` for uncontrolled mode.`);
    }

    if (value !== undefined && persistenceKey) {
      console.warn('[Chorus] Both `value` and `persistenceKey` were provided. `value` makes the message list controlled, so built-in persistence is ignored and message changes are not saved automatically. Remove `persistenceKey` or manage persistence in your controlled state.');
    }

    if (value !== undefined && !onChange) {
      console.warn('[Chorus] `value` makes Chorus controlled, but no `onChange` prop was provided. `onChange` is required for the built-in send/edit/delete/clear UI to update controlled messages.');
    }

    if (connector !== undefined && !isTransportPresent(transport) && onSend) {
      console.warn('[Chorus] `connector` only applies to the `transport` send path. With `onSend` you parse the response yourself — pass `connector` into the `useChorusStream` call inside your `onSend` if you need it.');
    }

    if (connectorOptions !== undefined && !isTransportPresent(transport) && onSend) {
      console.warn('[Chorus] `connectorOptions` only applies to the `transport` send path. With `onSend` you parse the response yourself — pass `connectorOptions` into the `useChorusStream` call inside your `onSend` if you need it.');
    }

    if (onStreamDone !== undefined && !isTransportPresent(transport) && onSend) {
      console.warn('[Chorus] `onStreamDone` only fires on the `transport` send path. With `onSend` it never fires — use `onFinish` for per-message completion, or surface stream-done telemetry from your `onSend` client.');
    }

    if (showCost && !isTransportPresent(transport) && onSend) {
      console.warn('[Chorus] `showCost` reads `metadata.usage` written by the `transport` send path. With `onSend` Chorus never wraps `onStreamMetadata`, so the cost chips stay at $0 and the conversation total never updates — hand-roll `metadata.usage` on each finalized assistant message you append/return from `onSend` (see the `showCost` section in docs/api.md for the recipe), or pass `transport`.');
    }

    const toolExecutionProps = [
      tools !== undefined && 'tools',
      onToolCall !== undefined && 'onToolCall',
      onToolDelta !== undefined && 'onToolDelta',
      continueOnToolError !== undefined && 'continueOnToolError',
    ].filter((name): name is string => typeof name === 'string');

    if (toolExecutionProps.length > 0 && !isTransportPresent(transport) && onSend) {
      const propList = toolExecutionProps.map(name => `\`${name}\``).join('/');
      const verb = toolExecutionProps.length > 1 ? 'only run' : 'only runs';
      console.warn(`[Chorus] ${propList} ${verb} on the \`transport\` send path. With \`onSend\` you execute tools yourself — registered tool handlers never run and tool callbacks never fire. Run tools inside your \`onSend\` client, or pass \`transport\`.`);
    }

    if (sending !== undefined && isTransportPresent(transport)) {
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

      if (!isTransportPresent(transport)) {
        console.warn(`[Chorus] ${propList} ${verb} ignored without \`transport\`. The automatic tool loop runs only on the \`transport\` send path; with \`onSend\` you drive tool continuations yourself. Pass \`transport\`, or gate continuations inside your \`onSend\` client.`);
      }
    }
  }, [messages, initialMessages, onChange, value, persistenceKey, connector, connectorOptions, transport, onSend, onStreamDone, showCost, sending, autoContinueTools, maxToolIterations, shouldContinueToolLoop, tools, onToolCall, onToolDelta, continueOnToolError]);
}
