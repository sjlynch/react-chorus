import React from 'react';
import { Chorus } from './Chorus';
import type { ChorusProps, ChorusRef } from './Chorus';

export type ChorusHeadlessProps<TMeta = Record<string, unknown>> = ChorusProps<TMeta>;

function ChorusHeadlessInner<TMeta = Record<string, unknown>>(
  { headless = true, ...props }: ChorusHeadlessProps<TMeta>,
  ref: React.ForwardedRef<ChorusRef<TMeta>>,
) {
  return <Chorus<TMeta> ref={ref} headless={headless} {...props} />;
}

export const ChorusHeadless = React.forwardRef(ChorusHeadlessInner) as <TMeta = Record<string, unknown>>(
  props: ChorusHeadlessProps<TMeta> & React.RefAttributes<ChorusRef<TMeta>>,
) => React.ReactElement | null;

(ChorusHeadless as React.NamedExoticComponent).displayName = 'ChorusHeadless';
