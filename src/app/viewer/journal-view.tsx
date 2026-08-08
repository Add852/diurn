"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { parseFrontmatter } from "@/lib/frontmatter";
import { EntryPreview, FM_LABELS, fmt } from "@/components/entry-preview";
import { MediaLightbox } from "@/components/media-lightbox";

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

interface MediaFile {
  name: string;
  path: string;
  date?: string;
  src: string;
  type: "image" | "video";
}

const FULL_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function monthLabel(dateStr: string) {
  const m = parseInt(dateStr.slice(5, 7));
  const y = dateStr.slice(0, 4);
  return `${FULL_MONTHS[m - 1] || "?"} ${y}`;
}

function monthKey(dateStr: string) { return dateStr.slice(0, 7); }

function distributeColumns<T>(items: T[], colCount: number): T[][] {
  const cols: T[][] = Array.from({ length: colCount }, () => []);
  for (let i = 0; i < items.length; i++) {
    cols[i % colCount].push(items[i]);
  }
  return cols;
}

export function JournalView() {
  const [rawEntries, setRawEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<FMEntry | null>(null);
  const [selectedMedia, setSelectedMedia] = useState<MediaFile[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaLightbox, setMediaLightbox] = useState<MediaFile | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [greyscale, setGreyscale] = useState(false);
  const [cols, setCols] = useState(2);

  useEffect(() => {
    function update() { setCols(window.innerWidth >= 1024 ? 4 : window.innerWidth >= 640 ? 3 : 2); }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const entries = useMemo(() =>
    rawEntries.map((e) => {
      const fm = parseFrontmatter(e.rendered_markdown);
      return { ...e, frontmatter: fm.data, body: fm.body, monthKey: monthKey(e.date), monthLabel: monthLabel(e.date) };
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

  useEffect(() => {
    setRawEntries([]);
    setSelected(null);
    setLoading(true);
    fetch("/api/entries")
      .then((r) => r.json())
      .then((d) => {
        const list: Entry[] = Array.isArray(d) ? d : [];
        setRawEntries(list);
        loadThumbnails(list);
      })
      .catch(() => setRawEntries([]))
      .finally(() => setLoading(false));
  }, []);

  const loadThumbnails = useCallback(async (list: Entry[]) => {
    const dates = [...new Set(list.map((e) => e.date))];
    if (dates.length === 0) return;
    if (dates.length === 1) {
      try {
        const r = await fetch(`/api/media?date=${dates[0]}&limit=1`);
        const j = await r.json();
        if (j.files?.length > 0) {
          setThumbnails({ [dates[0]]: j.files[0].src });
        }
      } catch {}
      return;
    }
    try {
      const r = await fetch(`/api/media?dates=${dates.join(",")}`);
      const j = await r.json();
      const t: Record<string, string> = {};
      for (const f of j.files || []) {
        if (f.date && !t[f.date]) {
          t[f.date] = f.src;
        }
      }
      setThumbnails(t);
    } catch {}
  }, []);

  function openEntry(e: FMEntry) {
    setSelected(e);
    setSelectedMedia([]);
    setMediaLightbox(null);
    setMediaLoading(true);
    fetch(`/api/media?date=${e.date}`)
      .then((r) => r.json())
      .then((d) => setSelectedMedia(d.files || []))
      .catch(() => setSelectedMedia([]))
      .finally(() => setMediaLoading(false));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          <input type="checkbox" checked={greyscale} onChange={(e) => setGreyscale(e.target.checked)} />
          greyscale
        </label>
      </div>

      {loading && (
        <p className="text-zinc-500 text-sm text-center py-8">Loading...</p>
      )}

      {!loading && entries.length === 0 && (
        <p className="text-zinc-500 text-sm text-center py-8">
          No entries yet. Create one first.
        </p>
      )}

      {!loading && entries.length > 0 && (
        <div className="space-y-10">
          {grouped.map(([mk, monthEntries]) => {
            const columns = distributeColumns(monthEntries, cols);
            return (
              <div key={mk}>
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3 sticky top-0 bg-zinc-950/90 backdrop-blur py-1 z-10">
                  {monthEntries[0]?.monthLabel || mk}
                </h3>
                <div className="flex gap-3">
                  {columns.map((col, ci) => (
                    <div key={ci} className="flex-1 flex flex-col gap-3">
                      {col.map((e) => (
                        <div
                          key={`${e.id}-${e.date}`}
                          onClick={() => openEntry(e)}
                          className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden cursor-pointer transition-colors hover:border-zinc-700"
                        >
                          {thumbnails[e.date] && (
                            <div className="aspect-video bg-zinc-800">
                              <img
                                src={thumbnails[e.date]}
                                alt=""
                                className={`w-full h-full object-cover ${greyscale ? "grayscale" : ""}`}
                                loading="lazy"
                              />
                            </div>
                          )}
                          <div className="p-3">
                            <p className="text-sm font-medium text-zinc-300 mb-1">{e.date}</p>
                            {Object.keys(e.frontmatter).length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {Object.entries(e.frontmatter).slice(0, 3).map(([k, v]) => (
                                  <span key={k} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[11px]">
                                    <span className="text-zinc-500">{FM_LABELS[k] || k}</span>
                                    <span className="text-zinc-300 font-medium">{fmt(k, v)}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => { setSelected(null); setMediaLightbox(null); }}>
          <div className="absolute inset-0 bg-black/70" />
          <div
            className="relative bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3 sticky top-0 bg-zinc-900 pb-2 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-emerald-400">{selected.date}</h3>
              <button
                onClick={() => setSelected(null)}
                className="text-zinc-500 hover:text-zinc-300 text-xl leading-none"
              >
                &times;
              </button>
            </div>

            {!mediaLoading && selectedMedia.length > 0 && (
              <div className="mb-3">
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {selectedMedia.map((m) => (
                    <button
                      key={m.path}
                      onClick={() => setMediaLightbox(m)}
                      className="flex-shrink-0 w-16 h-16 bg-zinc-800 rounded-lg border border-zinc-700 overflow-hidden hover:border-zinc-500 transition-colors"
                    >
                      {m.type === "image" ? (
                        <img src={m.src} alt={m.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full relative bg-zinc-900">
                          <video src={m.src} muted preload="auto" crossOrigin="anonymous" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </div>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <EntryPreview markdown={selected.rendered_markdown} />
          </div>
        </div>
      )}

      {mediaLightbox && (
        <MediaLightbox item={mediaLightbox} onClose={() => setMediaLightbox(null)} />
      )}
    </div>
  );
}