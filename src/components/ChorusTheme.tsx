import React from 'react';
import { styleVarsFromPalette, type Palette } from '../utils/paletteVars';

// `Palette`/`styleVarsFromPalette` live in `utils/paletteVars` so the bundler
// can isolate that pure helper from this component's React graph; re-exported
// here to keep the long-standing `./ChorusTheme` import path stable.
export type { Palette } from '../utils/paletteVars';
export { styleVarsFromPalette } from '../utils/paletteVars';

export function ChorusTheme({ palette, style, className, children }: { palette?: Palette; style?: React.CSSProperties; className?: string; children: React.ReactNode }) {
  const vars = React.useMemo(() => styleVarsFromPalette(palette), [palette]);
  return <div className={className} style={{ ...vars, ...style }}>{children}</div>;
}
