import type { BlockDefinition, BlockRenderProps } from './types';

export interface ImageProps {
  src?: string;
  alt?: string;
  width?: number | string;
  height?: number | string;
  caption?: string;
  /**
   * URL-scheme prefixes the block accepts in `src`. The matching is a literal
   * `startsWith` against the URL string, so a scheme entry must include its
   * trailing `:` (e.g. `'https:'`, `'http:'`) and a `data:` MIME prefix must
   * include the slash (e.g. `'data:image/'`). Defaults to
   * `['https:', 'data:image/']`, which blocks `javascript:`, `file:`, and any
   * other unsafe scheme — including `http:` so a model-driven URL cannot be
   * coerced into a mixed-content fetch by default.
   *
   * Opt in to `'http:'` only for trusted local-development environments (the
   * model output remains untrusted, so the same `<img>` could load a
   * tracker-pixel URL from any host) or to additional schemes (`'blob:'`) when
   * you control the URL source. Set this per-block via the block registry:
   *
   * ```ts
   * <Chorus blocks={{ image: { component: Image, props: { allowedProtocols: ['https:', 'data:image/', 'http://localhost'] } } }} />
   * ```
   */
  allowedProtocols?: string[];
  /**
   * Label shown when `src` does not match an `allowedProtocols` entry.
   * Defaults to `'Blocked image (unsafe URL scheme)'`; pass a localized
   * string here or relocalize through your own block registry entry.
   */
  blockedLabel?: string;
}

const DEFAULT_ALLOWED_PROTOCOLS = ['https:', 'data:image/'] as const;
const DEFAULT_BLOCKED_LABEL = 'Blocked image (unsafe URL scheme)';

/**
 * Whitelist of URL prefixes accepted by the built-in Image block. The
 * generative-UI security model assumes the model output is untrusted, so a
 * `javascript:` URL or any other unsafe scheme must not reach `<img src>`.
 * The default whitelist (`https:` + `data:image/`) is intentionally strict;
 * pass `allowedProtocols` to opt into additional schemes (e.g. `http:` for
 * local development).
 */
function isSafeImageSrc(src: string | undefined, allowed: readonly string[]): src is string {
  if (typeof src !== 'string') return false;
  for (const prefix of allowed) {
    if (typeof prefix === 'string' && prefix.length > 0 && src.startsWith(prefix)) return true;
  }
  return false;
}

export function Image({ src, alt, width, height, caption, allowedProtocols, blockedLabel }: BlockRenderProps<ImageProps> & ImageProps) {
  const allowed = allowedProtocols && allowedProtocols.length > 0 ? allowedProtocols : DEFAULT_ALLOWED_PROTOCOLS;
  if (!isSafeImageSrc(src, allowed)) {
    return (
      <div className="chorus-block-image chorus-block-image--blocked">
        <span className="chorus-block-image-blocked-label">{blockedLabel ?? DEFAULT_BLOCKED_LABEL}</span>
        {caption && <div className="chorus-block-image-caption">{caption}</div>}
      </div>
    );
  }
  return (
    <figure className="chorus-block-image">
      <img src={src} alt={alt ?? ''} width={width} height={height} loading="lazy" referrerPolicy="no-referrer" />
      {caption && <figcaption className="chorus-block-image-caption">{caption}</figcaption>}
    </figure>
  );
}

export const ImageBlock: BlockDefinition<ImageProps> = {
  component: Image,
};
