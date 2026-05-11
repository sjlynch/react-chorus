import React from 'react';

export interface Palette {
  chatBg?: string; chatText?: string; border?: string;
  assistantBubbleBg?: string; assistantText?: string; assistantBorder?: string;
  userBubbleBg?: string; userText?: string; userBorder?: string;
  inputAreaBg?: string; inputBg?: string; inputText?: string; inputBorder?: string;
  sendButtonBg?: string; sendButtonText?: string; focusRing?: string;
}

export function styleVarsFromPalette(p?: Palette): React.CSSProperties {
  const v: React.CSSProperties = {};
  const set = (k: string, val?: string) => { if (val) (v as any)[k] = val; };
  if (!p) return v;
  set('--chorus-chat-bg', p.chatBg); set('--chorus-chat-text', p.chatText); set('--chorus-border', p.border);
  set('--chorus-assistant-bg', p.assistantBubbleBg); set('--chorus-assistant-text', p.assistantText); set('--chorus-assistant-border', p.assistantBorder);
  set('--chorus-user-bg', p.userBubbleBg); set('--chorus-user-text', p.userText); set('--chorus-user-border', p.userBorder);
  set('--chorus-input-area-bg', p.inputAreaBg); set('--chorus-input-bg', p.inputBg); set('--chorus-input-text', p.inputText); set('--chorus-input-border', p.inputBorder);
  set('--chorus-send-bg', p.sendButtonBg); set('--chorus-send-text', p.sendButtonText); set('--chorus-focus-ring', p.focusRing);
  return v;
}

export function ChorusTheme({ palette, style, className, children }: { palette?: Palette; style?: React.CSSProperties; className?: string; children: React.ReactNode }) {
  const vars = React.useMemo(() => styleVarsFromPalette(palette), [palette]);
  return <div className={className} style={{ ...vars, ...style }}>{children}</div>;
}
