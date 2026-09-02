"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { EntryDialog } from "@/components/entry-dialog";
import { MediaLightbox, type MediaItem } from "@/components/media-lightbox";
import { MediaThumb, MediaImage } from "@/components/media-thumb";
const DAY_LIMIT = 500;

function fmtDay(date?: string) {
  if (!date || date === "unknown-date") return "Unknown date";
  const d = new Date(date + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  if (target.getTime() === today.getTime()) return "Today";
  if (target.getTime() === yesterday.getTime()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: target.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
}

export function MediaView() {
  const [groups, setGroups] = useState<Record<string, MediaItem[]>>({});
  const [dates, setDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [disabled, setDisabled] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [lightbox, setLightbox] = useState<{ items: MediaItem[]; index: number } | null>(null);
  const [entryDate, setEntryDate] = useState<string | null>(null);
  const [entryDates, setEntryDates] = useState<Set<string> | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleDay(date: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date); else next.add(date);
      return next;
    });
  }

  const sentinelRef = useRef<HTMLDivElement>(null);
  const seenGroups = useRef<Set<string>>(new Set());
  const inflight = useRef(false);

  const loadPage = useCallback(async (reset: boolean) => {
    if (inflight.current) return;
    inflight.current = true;
    const next = reset ? 0 : offset;
    const url = `/api/media?limit=${DAY_LIMIT}&offset=${next}`;
    try {
      const r = await fetch(url);
      const d = await r.json();
      if (d.disabled) {
        setDisabled(d.reason || "not_configured");
        setLoading(false);
        return;
      }
      setDisabled(null);
      if (d.scanning) {
        setScanning(true);
        return;
      }
      setScanning(false);
      if (reset) {
        seenGroups.current = new Set<string>();
        setGroups({});
        setDates([]);
      }
      const files: MediaItem[] = d.files || [];
      if (files.length === 0) {
        setHasMore(false);
        return;
      }
      setGroups((prev) => {
        const next = { ...prev };
        for (const f of files) {
          const k = f.date || "unknown-date";
          if (!next[k]) next[k] = [];
          next[k].push(f);
        }
        return next;
      });
      const seenDates = new Set<string>();
      const newDates: string[] = [];
      for (const f of files) {
        const k = f.date || "unknown-date";
        if (!seenDates.has(k) && !seenGroups.current.has(k)) {
          seenGroups.current.add(k);
          seenDates.add(k);
          newDates.push(k);
        }
      }
      setDates((prev) => reset ? newDates : [...prev, ...newDates]);
      setOffset(next + files.length);
      if (files.length < DAY_LIMIT) setHasMore(false);
    } catch {
      setHasMore(false);
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => {
    loadPage(true);
  }, []);

  useEffect(() => {
    fetch("/api/entries")
      .then((r) => r.json())
      .then((list) => {
        if (Array.isArray(list)) setEntryDates(new Set(list.map((e: any) => e.date)));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!hasMore || loading) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadPage(false);
    }, { rootMargin: "400px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading, loadPage]);

  useEffect(() => {
    if (!scanning) return;
    const t = setInterval(() => loadPage(true), 2000);
    return () => clearInterval(t);
  }, [scanning, loadPage]);

  function openLightbox(group: MediaItem[], index: number) {
    setLightbox({ items: group, index });
  }
  if (loading) {
    // Placeholder mimics the real masonry grid — tiles of varied heights, not
    // text lines — so the layout doesn't jump when content lands.
    return (
      <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-2">
        {[...Array(15)].map((_, i) => (
          <div
            key={i}
            className="mb-2 break-inside-avoid rounded-lg bg-zinc-800/60 animate-pulse"
            style={{ height: `${110 + ((i * 53) % 120)}px` }}
          />
        ))}
      </div>
    );
  }

  if (disabled) {
    return (
      <p className="text-zinc-500 text-sm text-center py-8">
        {disabled === "folder_missing" ? (
          <>Media folder is missing or unreachable (unmounted drive?). Check the path in{" "}
          <a href="/settings" className="text-emerald-400 hover:underline">Settings</a>.</>
        ) : (
          <>Media view is disabled. Enable the media gallery in{" "}
          <a href="/settings" className="text-emerald-400 hover:underline">Settings</a>.</>
        )}
      </p>
    );
  }

  if (dates.length === 0) {
    return (
      <p className="text-zinc-500 text-sm text-center py-8">
        {scanning ? "Scanning media folder..." : "No media yet. Drop photos into your media folder."}
      </p>
    );
  }

  return (
    <div className="space-y-8 pb-8">
      {scanning && (
        <p className="text-xs text-zinc-500 text-center animate-pulse">Scanning for new files...</p>
      )}
      {dates.map((date) => {
        const items = groups[date] || [];
        const isCollapsed = collapsed.has(date);
        return (
          <section key={date} className="space-y-2">
            <h3 className="flex items-baseline gap-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider sticky top-0 -mx-4 px-4 bg-zinc-950 py-2 z-10">
              <button onClick={() => toggleDay(date)} className="flex items-center gap-2 cursor-pointer hover:text-zinc-300 transition-colors" aria-expanded={!isCollapsed}>
                <svg className={`w-3 h-3 text-zinc-600 transition-transform ${isCollapsed ? "" : "rotate-90"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span>{fmtDay(date)}</span>
              </button>
              <span className="text-zinc-600 font-normal ml-1 normal-case">{items.length} {items.length === 1 ? "item" : "items"}</span>
              {entryDates?.has(date) && (
                <button
                  onClick={() => setEntryDate(date)}
                  className="ml-auto normal-case font-medium text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
                >
                  View entry
                </button>
              )}
            </h3>
            {!isCollapsed && (
              <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-2">
                {items.map((m, i) => (
                  <button
                    key={m.path}
                    onClick={() => openLightbox(items, i)}
                    className="mb-2 break-inside-avoid w-full bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-600 transition-colors"
                  >
                    {m.type === "image" ? (
                      <MediaImage src={m.src} alt={m.name} loading="lazy" className="w-full object-cover" />
                    ) : (
                      <div className="aspect-video">
                        <MediaThumb src={m.src} />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}
      <div ref={sentinelRef} className="h-1" />
      {hasMore && <p className="text-xs text-zinc-600 text-center">Loading more...</p>}
      {lightbox && (
        <MediaLightbox
          items={lightbox.items}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
      {entryDate && <EntryDialog date={entryDate} onClose={() => setEntryDate(null)} />}
    </div>
  );
}
