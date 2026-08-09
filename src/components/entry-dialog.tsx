"use client";

import { useEffect, useState } from "react";
import { EntryPreview } from "@/components/entry-preview";
import { MediaThumb } from "@/components/media-thumb";
import { MediaLightbox, type MediaItem } from "@/components/media-lightbox";

interface Props {
  date: string;
  onClose: () => void;
}

interface Entry {
  id: number;
  date: string;
  rendered_markdown: string;
}

// Entry preview dialog used by journal, media view, and home. Header is a
// fixed row (not sticky inside the scroller) so scrolled content can never
// slide up behind it.
export function EntryDialog({ date, onClose }: Props) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [lightbox, setLightbox] = useState<MediaItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/entries?date=${encodeURIComponent(date)}`)
      .then((r) => r.json())
      .then((list) => {
        if (cancelled) return;
        setEntry((Array.isArray(list) ? list : []).find((e) => e.date === date) ?? null);
      })
      .catch(() => { if (!cancelled) setEntry(null); });
    fetch(`/api/media?date=${encodeURIComponent(date)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setMedia(d.files || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [date]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        className="relative bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-zinc-800 flex-shrink-0">
          <h3 className="text-sm font-semibold text-emerald-400">{date}</h3>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 text-xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>
        <div className="overflow-y-auto px-5 pt-3 pb-5">
          {!entry && (
            <p className="text-zinc-500 text-sm py-4">Loading entry...</p>
          )}
          {entry && (
            <>
              {media.length > 0 && (
                <div className="mb-3">
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {media.map((m) => (
                      <button
                        key={m.path}
                        onClick={() => setLightbox(m)}
                        className="flex-shrink-0 w-16 h-16 bg-zinc-800 rounded-lg border border-zinc-700 overflow-hidden hover:border-zinc-500 transition-colors"
                      >
                        {m.type === "image" ? (
                          <img src={m.src} alt={m.name} className="w-full h-full object-cover" />
                        ) : (
                          <MediaThumb src={m.src} />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <EntryPreview markdown={entry.rendered_markdown} />
            </>
          )}
        </div>
      </div>
      {lightbox && <MediaLightbox item={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}