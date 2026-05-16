import { warnInDev } from '../../utils/warnings';

export function warnObserverError(callbackName: string, error: unknown) {
  warnInDev(`[Chorus] \`${callbackName}\` callback threw and was ignored so it could not interrupt message rendering.`, error);
}
