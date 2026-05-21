import React from 'react';
import type { CSSProperties } from 'react';
import type { ChorusProps } from '../Chorus.types';
import { styleVarsFromPalette } from '../utils/paletteVars';

export interface ChorusShellDerivedState {
  paletteVars: CSSProperties;
  visualSending: boolean;
  canAssistantRespond: boolean;
  resolvedShowJumpToBottomButton: boolean;
  persistenceLoading: boolean;
  canRenderEmptyAffordance: boolean;
  writesDisabled: boolean;
  composerDisabled: boolean;
  resolvedDisabledReason: string | undefined;
  controlledWithoutOnChange: boolean;
  canRunAssistantActions: boolean;
  canSubmitFeedback: boolean;
  canRetry: boolean;
  canSuggestPrompt: boolean;
  canDeleteMessages: boolean;
}

interface UseChorusShellDerivedStateArgs<TMeta> {
  palette: ChorusProps<TMeta>['palette'];
  sending: ChorusProps<TMeta>['sending'];
  sessionSending: boolean;
  transport: ChorusProps<TMeta>['transport'];
  onSend: ChorusProps<TMeta>['onSend'];
  showJumpToBottomButton: ChorusProps<TMeta>['showJumpToBottomButton'];
  headless: boolean;
  disabled: boolean;
  disabledReason: ChorusProps<TMeta>['disabledReason'];
  readOnly: boolean;
  builtInPersistenceKey: string;
  persistenceLoaded: boolean;
  value: ChorusProps<TMeta>['value'];
  onChange: ChorusProps<TMeta>['onChange'];
}

export function resolveBuiltInPersistenceKey<TMeta>(
  value: ChorusProps<TMeta>['value'],
  persistenceKey: ChorusProps<TMeta>['persistenceKey'],
): string {
  return value === undefined ? persistenceKey ?? '' : '';
}

export function useChorusShellDerivedState<TMeta = Record<string, unknown>>({
  palette,
  sending,
  sessionSending,
  transport,
  onSend,
  showJumpToBottomButton,
  headless,
  disabled,
  disabledReason,
  readOnly,
  builtInPersistenceKey,
  persistenceLoaded,
  value,
  onChange,
}: UseChorusShellDerivedStateArgs<TMeta>): ChorusShellDerivedState {
  const paletteVars = React.useMemo(() => styleVarsFromPalette(palette), [palette]);
  const visualSending = sending ?? sessionSending;
  const canAssistantRespond = Boolean(transport || onSend);
  const resolvedShowJumpToBottomButton = showJumpToBottomButton ?? !headless;
  const persistenceLoading = Boolean(builtInPersistenceKey) && !persistenceLoaded;
  const canRenderEmptyAffordance = value !== undefined || !builtInPersistenceKey || persistenceLoaded;
  const writesDisabled = disabled || readOnly || persistenceLoading;
  const composerDisabled = disabled || persistenceLoading;
  const resolvedDisabledReason = persistenceLoading ? disabledReason ?? 'Loading saved conversation…' : disabledReason;
  const controlledWithoutOnChange = value !== undefined && !onChange;
  const canRunAssistantActions = !writesDisabled && canAssistantRespond;
  const canUseWriteAffordances = !writesDisabled;

  return {
    paletteVars,
    visualSending,
    canAssistantRespond,
    resolvedShowJumpToBottomButton,
    persistenceLoading,
    canRenderEmptyAffordance,
    writesDisabled,
    composerDisabled,
    resolvedDisabledReason,
    controlledWithoutOnChange,
    canRunAssistantActions,
    canSubmitFeedback: canUseWriteAffordances,
    canRetry: canUseWriteAffordances,
    canSuggestPrompt: canUseWriteAffordances,
    canDeleteMessages: canUseWriteAffordances && !sessionSending,
  };
}
