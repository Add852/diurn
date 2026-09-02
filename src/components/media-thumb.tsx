"use client";

import { useState } from "react";

// Image with reserved-space placeholder: while loading (or on error), the
// img's box (callers give it aspect/w/h) shows a subtle pulse instead of
// alt text or filename. The bitmap paints over it once loaded.
export function MediaImage({ src, className = "", ...rest }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      {...rest}
      src={src}
      alt={rest.alt ?? ""}
      onLoad={() => setLoaded(true)}
      onError={() => setLoaded(true)}
      className={`${className} bg-zinc-800/60 ${loaded ? "" : "animate-pulse"}`}
    />
  );
}

// Video thumbnail: same pulse until metadata loads (poster frame appears).
export function MediaThumb({ src, iconClass = "w-4 h-4" }: { src: string; iconClass?: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative w-full h-full bg-zinc-950">
      <video
        src={src}
        muted
        preload="metadata"
        onLoadedMetadata={() => setLoaded(true)}
        className={`w-full h-full object-cover ${loaded ? "" : "animate-pulse bg-zinc-800/60"}`}
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
        <svg className={`${iconClass} text-white`} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
      </div>
    </div>
  );
}
