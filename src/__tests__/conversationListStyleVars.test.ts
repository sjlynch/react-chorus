import { describe, expect, it } from 'vitest';
import { styleVarsFromPalette as canonical, type Palette } from '../utils/paletteVars';
import { styleVarsFromPalette as conversationListLocal } from '../components/conversation-list/styleVars';

// `components/conversation-list/styleVars.ts` carries a local copy of the
// canonical `utils/paletteVars` helper so a standalone `ConversationList`
// import stays off the chat-input/icon chunk graph (see the budget guard in
// `scripts/verify-bundle-size.mjs`). These tests fail loudly if the two copies
// ever drift, so an added `Palette` field cannot silently go un-themed.

const FULL_PALETTE: Required<Palette> = {
  chatBg: '#101010', chatText: '#101011', border: '#101012',
  assistantBubbleBg: '#101013', assistantText: '#101014', assistantBorder: '#101015',
  userBubbleBg: '#101016', userText: '#101017', userBorder: '#101018',
  inputAreaBg: '#101019', inputBg: '#101020', inputText: '#101021', inputBorder: '#101022',
  sendButtonBg: '#101023', sendButtonText: '#101024', focusRing: '#101025',
  actionText: '#101026', actionHoverBg: '#101027', actionHoverText: '#101028',
  errorBg: '#101029', errorBorder: '#101030', errorText: '#101031',
  toolBorder: '#101032', toolHeaderBg: '#101033', toolHeaderText: '#101034', toolHeaderHover: '#101035',
  toolNameText: '#101036', toolBodyBg: '#101037', toolLabelText: '#101038', toolCodeText: '#101039',
  toolRunningText: '#101040',
};

describe('conversation-list styleVarsFromPalette parity', () => {
  it('matches the canonical helper for a fully-populated palette', () => {
    const canonicalVars = canonical(FULL_PALETTE);
    expect(conversationListLocal(FULL_PALETTE)).toEqual(canonicalVars);
    // Every palette key must surface as a `--chorus-*` variable.
    expect(Object.keys(canonicalVars)).toHaveLength(Object.keys(FULL_PALETTE).length);
  });

  it('matches the canonical helper for an undefined palette', () => {
    expect(conversationListLocal(undefined)).toEqual(canonical(undefined));
    expect(conversationListLocal(undefined)).toEqual({});
  });

  it('matches the canonical helper for a partially-populated palette', () => {
    const partial: Palette = { chatBg: '#fff', focusRing: '#abcabc', toolCodeText: '#123123' };
    expect(conversationListLocal(partial)).toEqual(canonical(partial));
  });
});
