import React from 'react';

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

export function styleVarsFromPalette(p?: Palette): React.CSSProperties {
  const v: React.CSSProperties & Record<`--${string}`, string> = {};
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

export function ChorusTheme({ palette, style, className, children }: { palette?: Palette; style?: React.CSSProperties; className?: string; children: React.ReactNode }) {
  const vars = React.useMemo(() => styleVarsFromPalette(palette), [palette]);
  return <div className={className} style={{ ...vars, ...style }}>{children}</div>;
}
