import type { Palette } from '../../components/ChorusTheme';

/** Default Indigo palette shared by most tabs. Matches the playground card chrome. */
export const DEMO_PALETTE: Palette = {
  chatBg: 'transparent',
  chatText: '#e7e7ea',
  assistantBubbleBg: 'rgba(255,255,255,0.05)',
  assistantBorder: 'rgba(255,255,255,0.08)',
  assistantText: '#f4f4f5',
  userBubbleBg: '#6366f1',
  userBorder: '#4f46e5',
  userText: '#ffffff',
  inputBg: 'rgba(255,255,255,0.04)',
  inputBorder: 'rgba(255,255,255,0.10)',
  inputText: '#f4f4f5',
  sendButtonBg: '#6366f1',
  sendButtonText: '#ffffff',
  focusRing: 'rgba(99,102,241,0.35)',
  border: 'rgba(255,255,255,0.06)',
};

export interface NamedPalette {
  id: string;
  label: string;
  swatch: string;
  palette: Palette;
}

export const THEME_PRESETS: NamedPalette[] = [
  {
    id: 'indigo',
    label: 'Indigo',
    swatch: '#6366f1',
    palette: DEMO_PALETTE,
  },
  {
    id: 'sunset',
    label: 'Sunset',
    swatch: '#f97316',
    palette: {
      ...DEMO_PALETTE,
      userBubbleBg: '#f97316',
      userBorder: '#ea580c',
      sendButtonBg: '#f97316',
      focusRing: 'rgba(249,115,22,0.35)',
    },
  },
  {
    id: 'forest',
    label: 'Forest',
    swatch: '#22c55e',
    palette: {
      ...DEMO_PALETTE,
      userBubbleBg: '#16a34a',
      userBorder: '#15803d',
      sendButtonBg: '#22c55e',
      focusRing: 'rgba(34,197,94,0.35)',
    },
  },
  {
    id: 'mono',
    label: 'Mono',
    swatch: '#a1a1aa',
    palette: {
      ...DEMO_PALETTE,
      userBubbleBg: '#27272a',
      userBorder: '#3f3f46',
      sendButtonBg: '#52525b',
      focusRing: 'rgba(161,161,170,0.35)',
    },
  },
];
