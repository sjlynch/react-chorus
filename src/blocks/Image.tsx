import type { BlockDefinition, BlockRenderProps } from './types';

export interface ImageProps {
  src?: string;
  alt?: string;
  width?: number | string;
  height?: number | string;
  caption?: string;
}

/**
 * Whitelist of URL schemes accepted by the built-in Image block. The
 * generative-UI security model assumes the model output is untrusted, so a
 * `javascript:` URL or any other unsafe scheme must not reach `<img src>`.
 */
function isSafeImageSrc(src: string | undefined): src is string {
  if (typeof src !== 'string') return false;
  if (src.startsWith('https://')) return true;
  if (src.startsWith('data:image/')) return true;
  return false;
}

export function Image({ src, alt, width, height, caption }: BlockRenderProps<ImageProps> & ImageProps) {
  if (!isSafeImageSrc(src)) {
    return (
      <div className="chorus-block-image chorus-block-image--blocked">
        <span className="chorus-block-image-blocked-label">Blocked image (unsafe URL scheme)</span>
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
