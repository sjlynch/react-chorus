import { Chorus } from './Chorus';
import type { ChorusProps } from './Chorus';

export type ChorusHeadlessProps<TMeta = Record<string, unknown>> = ChorusProps<TMeta>;

export function ChorusHeadless<TMeta = Record<string, unknown>>({ headless = true, ...props }: ChorusHeadlessProps<TMeta>) {
  return <Chorus<TMeta> headless={headless} {...props} />;
}
