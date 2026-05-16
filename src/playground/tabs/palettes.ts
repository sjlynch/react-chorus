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
    id: 'aurora',
    label: 'Aurora',
    swatch: 'linear-gradient(135deg, #06b6d4 0%, #a855f7 50%, #ec4899 100%)',
    palette: {
      ...DEMO_PALETTE,
      userBubbleBg: 'linear-gradient(135deg, #06b6d4 0%, #a855f7 50%, #ec4899 100%)',
      userBorder: 'rgba(236, 72, 153, 0.55)',
      sendButtonBg: 'linear-gradient(135deg, #06b6d4, #ec4899)',
      focusRing: 'rgba(168, 85, 247, 0.45)',
      assistantBorder: 'rgba(168, 85, 247, 0.18)',
    },
  },
  {
    id: 'neon',
    label: 'Neon',
    swatch: '#d946ef',
    palette: {
      ...DEMO_PALETTE,
      userBubbleBg: '#d946ef',
      userBorder: '#a21caf',
      sendButtonBg: '#d946ef',
      assistantBubbleBg: 'rgba(217, 70, 239, 0.07)',
      assistantBorder: 'rgba(217, 70, 239, 0.4)',
      focusRing: 'rgba(217, 70, 239, 0.5)',
    },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    swatch: 'linear-gradient(135deg, #fb923c, #ef4444)',
    palette: {
      ...DEMO_PALETTE,
      userBubbleBg: 'linear-gradient(135deg, #fb923c, #ef4444)',
      userBorder: 'rgba(239, 68, 68, 0.5)',
      sendButtonBg: 'linear-gradient(135deg, #fb923c, #ef4444)',
      focusRing: 'rgba(251, 146, 60, 0.45)',
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
      focusRing: 'rgba(34,197,94,0.4)',
    },
  },
  {
    id: 'glass',
    label: 'Glass',
    swatch: 'rgba(255,255,255,0.4)',
    palette: {
      ...DEMO_PALETTE,
      userBubbleBg: 'rgba(255,255,255,0.18)',
      userBorder: 'rgba(255,255,255,0.42)',
      userText: '#ffffff',
      assistantBubbleBg: 'rgba(255,255,255,0.08)',
      assistantBorder: 'rgba(255,255,255,0.22)',
      sendButtonBg: 'rgba(255,255,255,0.22)',
      sendButtonText: '#ffffff',
      focusRing: 'rgba(255,255,255,0.55)',
    },
  },
];
