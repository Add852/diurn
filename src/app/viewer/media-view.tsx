"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { type MediaItem } from "@/components/media-lightbox";
import { MediaThumb } from "@/components/media-thumb";
import { EntryDialog } from "@/components/entry-dialog";

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
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<{ item: MediaItem; group: MediaItem[]; index: number } | null>(null);
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
    setSelected({ item: group[index], group, index });
  }

  function nav(delta: number) {
    if (!selected) return;
    const next = selected.index + delta;
    if (next < 0 || next >= selected.group.length) return;
    setSelected({ item: selected.group[next], group: selected.group, index: next });
  }

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") nav(1);
      else if (e.key === "ArrowLeft") nav(-1);
      else if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  if (loading) {
    return <p className="text-zinc-500 text-sm text-center py-8">Loading...</p>;
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
      {selected && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={() => setSelected(null)}>
          <div className="absolute inset-0 bg-black/90" />
          <button
            onClick={(e) => { e.stopPropagation(); nav(-1); }}
            disabled={selected.index === 0}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-10 bg-black/60 rounded-full w-10 h-10 flex items-center justify-center text-white text-xl hover:bg-black/80 disabled:opacity-30"
            aria-label="Previous"
          >
            ›
          </button>
          <div className="relative max-w-5xl max-h-[85vh] w-full px-12" onClick={(e) => e.stopPropagation()}>
            {selected.item.type === "image" ? (
              <img src={selected.item.src} alt={selected.item.name} className="w-full h-auto max-h-[85vh] object-contain rounded-xl mx-auto" />
            ) : (
              <video src={selected.item.src} controls autoPlay className="w-full h-auto max-h-[85vh] rounded-xl mx-auto" />
            )}
            <p className="text-xs text-zinc-400 text-center mt-2 truncate">
              {fmtDay(selected.item.date)} · {selected.item.name}
              <span className="text-zinc-600 ml-2">{selected.index + 1}/{selected.group.length}</span>
            </p>
          </div>
          <button
            onClick={() => setSelected(null)}
            className="absolute top-2 right-2 z-10 bg-black/60 rounded-full w-8 h-8 flex items-center justify-center text-white text-lg hover:bg-black/80"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}
      {entryDate && <EntryDialog date={entryDate} onClose={() => setEntryDate(null)} />}
    </div>
  );
}
