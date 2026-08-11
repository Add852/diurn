"use client";

import { useEffect, useState, useRef, useCallback } from "react";

export interface MediaItem {
  name: string;
  path: string;
  date?: string;
  src: string;
  type: "image" | "video";
}

// Shared fullscreen media viewer. Used by the media page (group nav) and the
// entry dialog (single item — nav buttons hide when the group is one item).
// Navigation: arrow buttons, keyboard arrows/Escape, and swipe.
export function MediaLightbox({
  items,
  initialIndex = 0,
  onClose,
}: {
  items: MediaItem[];
  initialIndex?: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const prevIndex = useRef(initialIndex);
  const clamp = (n: number) => Math.max(0, Math.min(n, items.length - 1));

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => clamp(i + delta));
    },
    [items.length]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  // Slide the media in from the direction of travel on every index change.
  // Direct style writes (not a remount): the <img>/<video> node is reused, so
  // navigating doesn't re-fetch the previous item.
  useEffect(() => {
    if (index === prevIndex.current) return;
    const dir = index > prevIndex.current ? 1 : -1;
    prevIndex.current = index;
    const el = mediaRef.current;
    if (!el) return;
    el.style.transition = "none";
    el.style.transform = `translateX(${dir * 48}px)`;
    el.style.opacity = "0";
    void el.offsetWidth; // force reflow so the start position applies
    el.style.transition = "transform 200ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms ease";
    el.style.transform = "translateX(0)";
    el.style.opacity = "1";
  }, [index]);
  const item = items[clamp(index)];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
      onTouchStart={(e) => {
        const t = e.touches[0];
        touch.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        if (!touch.current) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - touch.current.x;
        const dy = t.clientY - touch.current.y;
        touch.current = null;
        // Horizontal swipe (more horizontal than vertical) = navigate.
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
          go(dx < 0 ? 1 : -1);
        }
      }}
    >
      <div className="absolute inset-0 bg-black/90" />
      <button
        onClick={(e) => { e.stopPropagation(); go(-1); }}
        disabled={items.length < 2 || index === 0}
        className="absolute left-2 top-1/2 -translate-y-1/2 z-10 bg-black/60 rounded-full w-10 h-10 flex items-center justify-center text-white text-xl hover:bg-black/80 disabled:opacity-30"
        aria-label="Previous"
      >
        ‹
      </button>
      <div
        className="relative max-w-4xl max-h-[90vh] w-full select-none"
        ref={mediaRef}
        onClick={(e) => e.stopPropagation()}
      >
        {item.type === "image" ? (
          <img
            src={item.src}
            alt={item.name}
            className="w-full h-auto max-h-[85vh] object-contain rounded-xl mx-auto pointer-events-none"
          />
        ) : (
          <video
            src={item.src}
            controls
            autoPlay
            className="w-full h-auto max-h-[85vh] rounded-xl mx-auto"
          />
        )}
        <p className="text-xs text-zinc-400 text-center mt-2 truncate">
          {item.date && `${item.date} · `}
          {item.name}
          {items.length > 1 && (
            <span className="text-zinc-600 ml-2">{index + 1}/{items.length}</span>
          )}
        </p>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); go(1); }}
        disabled={items.length < 2 || index === items.length - 1}
        className="absolute right-2 top-1/2 -translate-y-1/2 z-10 bg-black/60 rounded-full w-10 h-10 flex items-center justify-center text-white text-xl hover:bg-black/80 disabled:opacity-30"
        aria-label="Next"
      >
        ›
      </button>
      <button
        onClick={onClose}
        className="absolute top-2 right-2 z-10 bg-black/60 rounded-full w-8 h-8 flex items-center justify-center text-white text-lg hover:bg-black/80"
        aria-label="Close"
      >
        &times;
      </button>
    </div>
  );
}
