export function canWriteTextToClipboard() {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';
}

export function writeTextToClipboard(text: string) {
  if (!canWriteTextToClipboard()) return;
  void navigator.clipboard.writeText(text).catch(() => undefined);
}
