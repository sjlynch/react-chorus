import React from 'react';
import { Chorus } from './Chorus';
import type { ChorusProps } from './Chorus';

export type ChorusHeadlessProps = ChorusProps;

export function ChorusHeadless({ headless = true, ...props }: ChorusHeadlessProps) {
  return <Chorus headless={headless} {...props} />;
}
