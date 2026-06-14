import type { BlockDefinition, BlockRenderProps } from './types';

/**
 * Model-emitted props for the built-in Image block — the fields the assistant
 * is allowed to stream in its `__render_block` call.
 *
 * The URL whitelist (`allowedProtocols`) and the blocked-state label
 * (`blockedLabel`) are deliberately **not** part of this interface. They are
 * host-only policy: `BlockRenderer` spreads model-emitted block props straight
 * onto the component, so if they lived here an untrusted model could stream its
 * own `allowedProtocols` and widen the whitelist (or relabel the blocked state
 * to hide that policy fired). Configure them in host code through
 * {@link createImageBlock} instead.
 */
export interface ImageProps {
  src?: string;
  alt?: string;
  width?: number | string;
  height?: number | string;
  caption?: string;
}

/**
 * Host-only configuration for the built-in Image block, passed to
 * {@link createImageBlock}. Never streamed by the model.
 */
export interface ImageBlockOptions {
  /**
   * URL entries the block accepts in `src`. Each entry is matched against the
   * *parsed* URL, not by raw string prefix, so an origin opt-in cannot be
   * satisfied by an attacker-controlled lookalike host:
   *
   * - A **scheme** entry ends with `:` (e.g. `'https:'`, `'http:'`, `'blob:'`)
   *   and matches when the URL's protocol equals it.
   * - A **`data:` MIME** entry (e.g. `'data:image/'`) matches a data URL whose
   *   media type starts with it. Data URLs carry no host, so there is nothing
   *   to spoof.
   * - An **origin** entry includes a host (e.g. `'http://localhost'`,
   *   `'https://cdn.example.com'`) and matches only when the URL's protocol and
   *   hostname match exactly — so `'http://localhost'` accepts
   *   `http://localhost:3000/x.png` but rejects `http://localhost.evil.com/x.png`.
   *   Pin a port (`'http://localhost:3000'`) or a path prefix
   *   (`'https://cdn.example.com/imgs/'`) to narrow further.
   *
   * Defaults to `['https:', 'data:image/']`, which blocks `javascript:`,
   * `file:`, and `http:` so a model-driven URL cannot be coerced into a
   * mixed-content fetch by default. Opt into `'http://localhost'` for trusted
   * local-development environments only — the model output remains untrusted,
   * so a bare `'http:'` entry would let it load a tracker pixel from any host.
   */
  allowedProtocols?: readonly string[];
  /**
   * Label shown when `src` does not match an `allowedProtocols` entry.
   * Defaults to `'Blocked image (unsafe URL scheme)'`; pass a localized string
   * to relabel the placeholder.
   */
  blockedLabel?: string;
}

const DEFAULT_ALLOWED_PROTOCOLS = ['https:', 'data:image/'] as const;
const DEFAULT_BLOCKED_LABEL = 'Blocked image (unsafe URL scheme)';

/** Matches a scheme-only entry like `https:`, `http:`, or `blob:`. */
const SCHEME_ONLY = /^[a-z][a-z0-9+.-]*:$/i;

/**
 * Whether `src` (already parsed into `url`, or `null` if it was not a valid
 * absolute URL) matches a single host-configured whitelist `entry`. Matching is
 * done against the parsed URL's protocol/hostname rather than a raw
 * `startsWith`, so an origin entry like `'http://localhost'` cannot be
 * satisfied by an attacker-controlled lookalike such as `http://localhost.evil.com`.
 */
function matchesAllowedEntry(src: string, url: URL | null, entry: string): boolean {
  // `data:` MIME prefixes (e.g. `data:image/`): data URLs carry no host, so a
  // literal prefix is safe and is the only way to scope the media type.
  if (entry.startsWith('data:')) return src.startsWith(entry);
  if (!url) return false;
  // Scheme-only entry (`https:`, `http:`, `blob:`): compare the URL protocol.
  // `new URL` normalizes the scheme, so this also catches `HTTPS://…`.
  if (SCHEME_ONLY.test(entry)) return url.protocol === entry.toLowerCase();
  // Origin entry (`http://localhost`, `https://cdn.example.com[/path]`):
  // require an exact protocol + hostname match. A port or path in the entry
  // narrows further; omitting them accepts any port/path on that host.
  let entryUrl: URL;
  try {
    entryUrl = new URL(entry);
  } catch {
    return false;
  }
  if (url.protocol !== entryUrl.protocol) return false;
  if (url.hostname.toLowerCase() !== entryUrl.hostname.toLowerCase()) return false;
  if (entryUrl.port && url.port !== entryUrl.port) return false;
  if (entryUrl.pathname && entryUrl.pathname !== '/' && !url.pathname.startsWith(entryUrl.pathname)) return false;
  return true;
}

/**
 * Whitelist gate for the built-in Image block. The generative-UI security model
 * treats model output as untrusted, so a `javascript:` URL or any other unsafe
 * scheme must not reach `<img src>`. The default whitelist (`https:` +
 * `data:image/`) is intentionally strict; widen it from host code through
 * {@link createImageBlock}.
 */
function isSafeImageSrc(src: string | undefined, allowed: readonly string[]): src is string {
  if (typeof src !== 'string' || src.length === 0) return false;
  let url: URL | null;
  try {
    url = new URL(src);
  } catch {
    url = null;
  }
  for (const entry of allowed) {
    if (typeof entry === 'string' && entry.length > 0 && matchesAllowedEntry(src, url, entry)) return true;
  }
  return false;
}

export function Image({
  src,
  alt,
  width,
  height,
  caption,
  allowedProtocols,
  blockedLabel,
}: BlockRenderProps<ImageProps> & ImageProps & ImageBlockOptions) {
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

/**
 * Build a packaged Image block with a host-pinned URL whitelist. This is the
 * safe configuration path: the returned block strips any `allowedProtocols` /
 * `blockedLabel` an untrusted model tries to stream, so only the policy passed
 * here governs which URLs render.
 *
 * ```ts
 * import { createImageBlock } from 'react-chorus/blocks';
 *
 * // Production default — strict whitelist, model cannot widen it.
 * <Chorus blocks={{ image: createImageBlock() }} />
 *
 * // Local development — also accept the dev server's localhost origin.
 * const devImage = createImageBlock({
 *   allowedProtocols: ['https:', 'data:image/', 'http://localhost'],
 * });
 * <Chorus blocks={{ image: devImage }} />
 * ```
 */
export function createImageBlock(options: ImageBlockOptions = {}): BlockDefinition<ImageProps> {
  const allowedProtocols =
    options.allowedProtocols && options.allowedProtocols.length > 0
      ? [...options.allowedProtocols]
      : [...DEFAULT_ALLOWED_PROTOCOLS];
  const blockedLabel = options.blockedLabel ?? DEFAULT_BLOCKED_LABEL;

  function ConfiguredImage(modelProps: BlockRenderProps<ImageProps> & ImageProps & Partial<ImageBlockOptions>) {
    // Strip any safety fields the model streamed; the host-pinned policy from
    // this closure is the only one that reaches `Image`.
    const { allowedProtocols: _modelProtocols, blockedLabel: _modelLabel, ...safe } = modelProps;
    return <Image {...safe} allowedProtocols={allowedProtocols} blockedLabel={blockedLabel} />;
  }
  ConfiguredImage.displayName = 'ImageBlock';

  return { component: ConfiguredImage };
}

/**
 * Packaged Image block with the strict default whitelist (`https:` +
 * `data:image/`). Safe to drop straight into `<Chorus blocks>`: model-streamed
 * `allowedProtocols` / `blockedLabel` are ignored. Call
 * `createImageBlock({ allowedProtocols })` when you need to widen the policy
 * from host code (e.g. `'http://localhost'` for dev-server screenshots).
 */
export const ImageBlock: BlockDefinition<ImageProps> = createImageBlock();
