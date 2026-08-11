"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { MediaLightbox, type MediaItem } from "@/components/media-lightbox";
import { MediaThumb } from "@/components/media-thumb";
import { EntryDialog } from "@/components/entry-dialog";
import { SkeletonLines } from "@/components/skeleton";
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
  const [disabled, setDisabled] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [lightbox, setLightbox] = useState<{ items: MediaItem[]; index: number } | null>(null);
  const [entryDate, setEntryDate] = useState<string | null>(null);
  const [entryDates, setEntryDates] = useState<Set<string> | null>(null);

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
        setDisabled(true);
        setLoading(false);
        return;
      }
      setDisabled(false);
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
    return <SkeletonLines />;
  }

  if (disabled) {
    return (
      <p className="text-zinc-500 text-sm text-center py-8">
        Media view is disabled. Enable the media gallery in{" "}
        <a href="/settings" className="text-emerald-400 hover:underline">Settings</a>.
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
        return (
          <section key={date} className="space-y-2">
            <h3 className="flex items-baseline gap-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider sticky top-0 -mx-4 px-4 bg-zinc-950 py-2 z-10">
              <span>{fmtDay(date)}</span>
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
            <div className="flex gap-2 overflow-x-auto pb-2 snap-x snap-mandatory -mx-4 px-4">
              {items.map((m, i) => (
                <button
                  key={m.path}
                  onClick={() => openLightbox(items, i)}
                  className="flex-shrink-0 w-40 aspect-square bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-600 transition-colors snap-start"
                >
                  {m.type === "image" ? (
                    <img src={m.src} alt={m.name} loading="lazy" className="w-full h-full object-cover" />
                  ) : (
                    <MediaThumb src={m.src} />
                  )}
                </button>
              ))}
            </div>
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
