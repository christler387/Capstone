import React, { useEffect, useState } from 'react';

// Pictures saved by the server come with a small thumbnail beside the full-size file: product-<id>-t.webp.
const SAVED_PICTURE = /^(\/api\/uploads\/products\/product-[^/?#]+)\.webp$/;

export const thumbnailAddress = (src: string): string | null => {
  const match = src.match(SAVED_PICTURE);
  return match ? `${match[1]}-t.webp` : null;
};

interface ProductImageProps {
  src: string;
  alt: string;
  // The size the picture is shown at. Setting it reserves the space, so the page does not jump while it loads.
  width: number;
  height: number;
  className?: string;
  // Use the full-size picture (for previews) instead of the small thumbnail used in lists.
  full?: boolean;
  title?: string;
  onClick?: (event: React.MouseEvent<HTMLImageElement>) => void;
}

// A product picture that loads only when it is near the screen, decodes off the main thread,
// and shows an icon instead of a broken picture when it cannot be loaded.
export const ProductImage: React.FC<ProductImageProps> = ({
  src,
  alt,
  width,
  height,
  className,
  full = false,
  title,
  onClick,
}) => {
  const thumb = full ? null : thumbnailAddress(src);
  const [stage, setStage] = useState<'thumb' | 'full' | 'failed'>(thumb ? 'thumb' : 'full');

  useEffect(() => {
    setStage(thumb ? 'thumb' : 'full');
  }, [src, full]);

  if (stage === 'failed') {
    return (
      <span
        className={`${className ?? ''} is-broken`}
        role="img"
        aria-label={`${alt} (picture unavailable)`}
        style={{ width, height }}
      >
        <i className="bx bx-image-alt" aria-hidden="true"></i>
      </span>
    );
  }

  return (
    <img
      src={stage === 'thumb' && thumb ? thumb : src}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={className}
      title={title}
      onClick={onClick}
      onError={() => setStage(stage === 'thumb' ? 'full' : 'failed')}
    />
  );
};
