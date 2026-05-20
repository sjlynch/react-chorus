import type { CSSProperties } from 'react';
import type { Palette } from '../../utils/paletteVars';

/**
 * Conversation-list-local copy of `utils/paletteVars.ts`'s `styleVarsFromPalette`.
 *
 * `ConversationList` must stay importable without the chat-input/icon chunk
 * graph — `scripts/verify-bundle-size.mjs` enforces this and keeps the
 * standalone bundle lean. The bundler folds the single shared `paletteVars`
 * helper into the icon-bearing chunk (every other themeable root already lives
 * there), so the conversation-list chunk carries its own copy instead of
 * importing across to it.
 *
 * Behaviour is identical to the canonical helper and kept in lockstep by the
 * parity test in `src/__tests__/conversationListStyleVars.test.ts` — update both
 * `styleVarsFromPalette` implementations together.
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
