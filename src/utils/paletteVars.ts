import type { CSSProperties } from 'react';

/**
 * Palette of `--chorus-*` CSS-variable overrides shared by every themeable root
 * component (`Chorus`, `ChatWindow`, `ChatInput`, `ConversationList`) and by the
 * standalone `<ChorusTheme>` wrapper.
 */
export interface Palette {
  chatBg?: string; chatText?: string; border?: string;
  assistantBubbleBg?: string; assistantText?: string; assistantBorder?: string;
  userBubbleBg?: string; userText?: string; userBorder?: string;
  inputAreaBg?: string; inputBg?: string; inputText?: string; inputBorder?: string;
  sendButtonBg?: string; sendButtonText?: string; focusRing?: string;
  actionText?: string; actionHoverBg?: string; actionHoverText?: string;
  errorBg?: string; errorBorder?: string; errorText?: string;
  toolBorder?: string; toolHeaderBg?: string; toolHeaderText?: string; toolHeaderHover?: string;
  toolNameText?: string; toolBodyBg?: string; toolLabelText?: string; toolCodeText?: string;
}

/**
 * Maps a {@link Palette} to a `style` object of `--chorus-*` custom properties,
 * emitting only the keys the palette actually defines so unset variables keep
 * resolving through the normal CSS cascade.
 *
 * Kept in `utils/` (free of any runtime import) rather than in `ChorusTheme.tsx`
 * so the bundler can park it in a dependency-free shared chunk — see the
 * `shared-leaf` group in `vite.config.ts`.
 */
export function styleVarsFromPalette(p?: Palette): CSSProperties {
  const v: CSSProperties & Record<`--${string}`, string> = {};
  const set = (k: `--${string}`, val?: string) => { if (val) v[k] = val; };
  if (!p) return v;
  set('--chorus-chat-bg', p.chatBg); set('--chorus-chat-text', p.chatText); set('--chorus-border', p.border);
  set('--chorus-assistant-bg', p.assistantBubbleBg); set('--chorus-assistant-text', p.assistantText); set('--chorus-assistant-border', p.assistantBorder);
  set('--chorus-user-bg', p.userBubbleBg); set('--chorus-user-text', p.userText); set('--chorus-user-border', p.userBorder);
  set('--chorus-input-area-bg', p.inputAreaBg); set('--chorus-input-bg', p.inputBg); set('--chorus-input-text', p.inputText); set('--chorus-input-border', p.inputBorder);
  set('--chorus-send-bg', p.sendButtonBg); set('--chorus-send-text', p.sendButtonText); set('--chorus-focus-ring', p.focusRing);
  set('--chorus-action-text', p.actionText); set('--chorus-action-hover-bg', p.actionHoverBg); set('--chorus-action-hover-text', p.actionHoverText);
  set('--chorus-error-bg', p.errorBg); set('--chorus-error-border', p.errorBorder); set('--chorus-error-text', p.errorText);
  set('--chorus-tool-border', p.toolBorder); set('--chorus-tool-header-bg', p.toolHeaderBg); set('--chorus-tool-header-text', p.toolHeaderText); set('--chorus-tool-header-hover', p.toolHeaderHover);
  set('--chorus-tool-name-text', p.toolNameText); set('--chorus-tool-body-bg', p.toolBodyBg); set('--chorus-tool-label-text', p.toolLabelText); set('--chorus-tool-code-text', p.toolCodeText);
  return v;
}
