"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { parseFrontmatter } from "@/lib/frontmatter";
import { fmt } from "@/components/entry-preview";
import { EntryDialog } from "@/components/entry-dialog";
import { MediaThumb, MediaImage } from "@/components/media-thumb";
import { SkeletonLines } from "@/components/skeleton";

// Journal icon used by media-less entries.
function JournalIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}
interface Entry {
  id: number;
  date: string;
  rendered_markdown: string;
}

interface FMEntry extends Entry {
  frontmatter: Record<string, any>;
  body: string;
  monthKey: string;
  monthLabel: string;
}

interface Thumb {
  src: string;
  type: string;
}

const FULL_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function monthLabel(dateStr: string) {
  const m = parseInt(dateStr.slice(5, 7));
  const y = dateStr.slice(0, 4);
  return `${FULL_MONTHS[m - 1] || "?"} ${y}`;
}


// Masonry is pure CSS multi-column now (columns-2 md:columns-3 lg:columns-4):
// the browser balances from real rendered heights and reflows automatically
// when lazy images load or the viewport resizes. No JS estimation.





function EntryCard({ entry, thumb, onOpen }: { entry: FMEntry; thumb?: Thumb; onOpen: () => void }) {
  if (!thumb) {
    const chips = Object.entries(entry.frontmatter).slice(0, 3);
    return (
      <button
        onClick={onOpen}
        className="group w-full rounded-xl border border-zinc-800/60 bg-zinc-900/60 p-4 text-left cursor-pointer hover:border-zinc-600/70 hover:bg-zinc-900 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-800/60 text-zinc-500">
            <JournalIcon />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-100">{entry.date}</p>
            {chips.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {chips.map(([k, v]) => (
                  <span key={k} className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-1.5 py-0.5 text-[11px]">
                    <span className="text-zinc-500">{k}</span>
                    <span className="font-medium text-zinc-200">{fmt(v)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </button>
    );
  }

  const chips = Object.entries(entry.frontmatter).slice(0, 3);
  const chipsEl = chips.length > 0 && (
    <div className="flex flex-wrap gap-1">
      {chips.map(([k, v]) => (
        <span key={k} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm rounded-md text-[11px] shadow">
          <span className="text-zinc-400">{k}</span>
          <span className="text-zinc-100 font-medium">{fmt(v)}</span>
        </span>
      ))}
    </div>
  );
  return (
      <button
        onClick={onOpen}
        className="group relative w-full rounded-xl overflow-hidden bg-zinc-800/40 cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        {thumb.type === "image" ? (
          <MediaImage
            src={thumb.src}
            className="w-full aspect-[4/3] object-cover group-hover:scale-[1.02] transition-transform duration-300"
          />
        ) : (
          <div className="aspect-[4/3]">
            <MediaThumb src={thumb.src} />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-3">
          <p className="text-sm font-semibold text-white drop-shadow">{entry.date}</p>
          {chipsEl}
        </div>
      </button>
    );
  }

export function JournalView() {
  const searchParams = useSearchParams();
  const pendingDate = searchParams.get("date");
  const openedFor = useRef<string | null>(null);
  const [rawEntries, setRawEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogDate, setDialogDate] = useState<string | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, Thumb>>({});

  const entries = useMemo(() =>
    rawEntries.map((e) => {
      const fm = parseFrontmatter(e.rendered_markdown);
      return { ...e, frontmatter: fm.data, body: fm.body, monthKey: e.date.slice(0, 7), monthLabel: monthLabel(e.date) };
    }),
    [rawEntries]
  );

  const grouped = useMemo(() => {
    const map: Record<string, FMEntry[]> = {};
    for (const e of entries) {
      if (!map[e.monthKey]) map[e.monthKey] = [];
      map[e.monthKey].push(e);
    }
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [entries]);



  const loadThumbnails = useCallback(async (list: Entry[]) => {
    const dates = [...new Set(list.map((e) => e.date))];
    if (dates.length === 0) return;
    if (dates.length === 1) {
      try {
        const r = await fetch(`/api/media?date=${dates[0]}&limit=1`);
        const j = await r.json();
        if (j.files?.length > 0) {
          setThumbnails({ [dates[0]]: { src: j.files[0].src, type: j.files[0].type } });
        }
      } catch {}
      return;
    }
    try {
      const r = await fetch(`/api/media?dates=${dates.join(",")}`);
      const j = await r.json();
      const t: Record<string, Thumb> = {};
      for (const f of j.files || []) {
        if (f.date && !t[f.date]) {
          t[f.date] = { src: f.src, type: f.type };
        }
      }
      setThumbnails(t);
    } catch {}
  }, []);
  const loadEntries = useCallback(async () => {
    try {
      const r = await fetch("/api/entries");
      const d = await r.json();
      const list: Entry[] = Array.isArray(d) ? d : [];
      setRawEntries(list);
      loadThumbnails(list);
    } catch {
      setRawEntries([]);
    }
  }, [loadThumbnails]);
  useEffect(() => {
    setRawEntries([]);
    setDialogDate(null);
    setLoading(true);
    loadEntries().finally(() => setLoading(false));
  }, [loadEntries]);

  function openEntry(e: FMEntry) {
    setDialogDate(e.date);
  }

  useEffect(() => {
    if (!pendingDate || openedFor.current === pendingDate) return;
    const entry = entries.find((e) => e.date === pendingDate);
    if (!entry) return;
    openedFor.current = pendingDate;
    openEntry(entry);
  }, [pendingDate, entries]);


  return (
    <div className="space-y-4">
      {loading && <SkeletonLines />}

      {!loading && entries.length === 0 && (
        <p className="text-zinc-500 text-sm text-center py-8">
          No entries yet. Create one first.
        </p>
      )}

      {!loading && entries.length > 0 && (
        <div className="space-y-10">
          {grouped.map(([mk, monthEntries]) => (
            <div key={mk}>
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3 sticky top-0 -mx-4 px-4 bg-zinc-950 py-1 z-10">
                {monthEntries[0]?.monthLabel || mk}
              </h3>
              <div className="columns-2 md:columns-3 lg:columns-4 gap-3">
                {monthEntries.map((e) => (
                  <div key={e.id} className="mb-3 break-inside-avoid">
                    <EntryCard entry={e} thumb={thumbnails[e.date]} onOpen={() => openEntry(e)} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {dialogDate && (
        <EntryDialog date={dialogDate} onClose={() => setDialogDate(null)} onChanged={loadEntries} />
      )}
    </div>
  );
}