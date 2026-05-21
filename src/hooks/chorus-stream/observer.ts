import { warnInDev } from '../../streaming/internal/devMode';

export function safeOnObserverError(callbackName: string, error: unknown) {
  warnInDev(`[Chorus] \`${callbackName}\` callback threw and was ignored so the original stream error could be re-thrown.`, error);
}
