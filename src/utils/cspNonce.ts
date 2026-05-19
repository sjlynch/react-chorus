// CSP nonce applied to runtime-injected <style> elements (chorus-md-styles and
// chorus-hljs-theme-*). When set, apps can run under a strict
// `style-src 'self' 'nonce-XYZ'` policy without `'unsafe-inline'`. Apps with
// truly strict policies may also need the headless entry to avoid React inline
// `style=""` attributes, which `style-src-attr` blocks regardless of nonce.

let chorusStyleNonce: string | null = null;

export function setChorusStyleNonce(nonce: string | null | undefined): void {
  chorusStyleNonce = typeof nonce === 'string' && nonce.length > 0 ? nonce : null;
}

export function getChorusStyleNonce(): string | null {
  if (chorusStyleNonce) return chorusStyleNonce;
  if (typeof globalThis !== 'undefined') {
    const fromGlobal = (globalThis as { __chorusStyleNonce?: unknown }).__chorusStyleNonce;
    if (typeof fromGlobal === 'string' && fromGlobal.length > 0) return fromGlobal;
  }
  return null;
}

export function applyChorusStyleNonce(el: HTMLStyleElement): void {
  const nonce = getChorusStyleNonce();
  if (!nonce) return;
  el.setAttribute('nonce', nonce);
  (el as HTMLStyleElement & { nonce?: string }).nonce = nonce;
}
