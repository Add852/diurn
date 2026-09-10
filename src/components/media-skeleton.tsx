"use client";

// Shared media loading placeholder: a soft shimmer sweep, used everywhere
// media loads — viewer masonry, integration panels, entry previews, lightbox.
// Same visual language app-wide instead of ad-hoc animate-pulse blocks.

export function MediaSkeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`relative overflow-hidden bg-zinc-800/60 rounded-lg ${className}`}
      style={style}
      aria-hidden="true"
    >
      <div className="media-shimmer absolute inset-0" />
    </div>
  );
}

// Masonry placeholder for the viewer grid: varied-height tiles mimicking the
// real layout so nothing jumps when photos land.
export function MediaSkeletonGrid({ count = 15 }: { count?: number }) {
  return (
    <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-2">
      {[...Array(count)].map((_, i) => (
        <MediaSkeleton key={i} className="mb-2 break-inside-avoid" style={{ height: `${110 + ((i * 53) % 120)}px` }} />
      ))}
    </div>
  );
}
