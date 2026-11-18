import { Film } from 'lucide-react';
import { useState } from 'react';

interface ThumbnailImageProps {
  src?: string;
  alt: string;
  className?: string;
}

export function ThumbnailImage({ src, alt, className = '' }: ThumbnailImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-[#15171E] via-[#101218] to-[#0B0C10] text-[#9CA3B2] ${className}`}
      >
        <Film className="h-8 w-8 text-[#E50914]/70" />
        <span className="mt-2 max-w-[85%] truncate px-3 text-center text-xs font-medium text-[#9CA3B2]">
          {alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
