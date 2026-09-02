"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EntryPreview } from "@/components/entry-preview";
import { MediaThumb, MediaImage } from "@/components/media-thumb";
import { MediaLightbox, type MediaItem } from "@/components/media-lightbox";

interface Props {
  date: string;
  onClose: () => void;
  /** Called after an edit or delete so the caller can refresh its entry list. */
  onChanged?: () => void;
}

interface Entry {
  id: number;
  date: string;
  rendered_markdown: string;
}

// Entry preview dialog used by journal, media view, and home. Header is a
// fixed row (not sticky inside the scroller) so scrolled content can never
// slide up behind it.
export function EntryDialog({ date, onClose, onChanged }: Props) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

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

  async function saveEdit() {
    if (!entry) return;
    setBusy(true);
    setActionError("");
    try {
      const res = await fetch("/api/entries", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, markdown: draft }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to save");
      setEntry({ ...entry, rendered_markdown: draft });
      setEditing(false);
      onChanged?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function deleteEntry() {
    if (!entry) return;
    setBusy(true);
    setActionError("");
    try {
      const res = await fetch(`/api/entries?date=${encodeURIComponent(date)}`, { method: "DELETE" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to delete");
      onChanged?.();
      onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to delete");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        className="relative bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl max-h-[88vh] flex flex-col shadow-2xl"
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

        {entry && !editing && !confirmDelete && (
          <div className="flex flex-wrap items-center gap-2 px-5 pt-3 flex-shrink-0">
            <button
              onClick={() => { setDraft(entry.rendered_markdown); setEditing(true); setActionError(""); }}
              className="rounded-lg border border-zinc-700 hover:border-zinc-500 px-3 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 transition-colors"
            >
              Edit markdown
            </button>
            <Link
              href={`/chat?date=${date}`}
              className="rounded-lg border border-zinc-700 hover:border-emerald-600 px-3 py-1.5 text-xs text-zinc-300 hover:text-emerald-300 transition-colors"
            >
              Re-run in chat
            </Link>
            <button
              onClick={() => { setConfirmDelete(true); setActionError(""); }}
              className="rounded-lg border border-red-900/60 hover:border-red-600 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 transition-colors ml-auto"
            >
              Delete
            </button>
          </div>
        )}

        {confirmDelete && (
          <div className="flex items-center gap-2 px-5 pt-3 flex-shrink-0">
            <p className="text-sm text-red-300">Delete this entry and its note file?</p>
            <button
              onClick={deleteEntry}
              disabled={busy}
              className="rounded-lg bg-red-700 hover:bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              Delete
            </button>
            <button
              onClick={() => { setConfirmDelete(false); setActionError(""); }}
              disabled={busy}
              className="rounded-lg border border-zinc-700 hover:border-zinc-500 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}

        {editing && (
          <div className="px-5 pt-3 flex-shrink-0">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={12}
              spellCheck={false}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-xs font-mono text-zinc-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-y"
            />
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={saveEdit}
                disabled={busy}
                className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={() => { setEditing(false); setActionError(""); }}
                disabled={busy}
                className="rounded-lg border border-zinc-700 hover:border-zinc-500 px-3 py-1.5 text-sm text-zinc-300 disabled:opacity-50"
              >
                Cancel
              </button>
              {busy && <span className="text-xs text-zinc-500">Saving...</span>}
            </div>
          </div>
        )}

        {actionError && (
          <p className="px-5 pt-2 text-xs text-red-400 flex-shrink-0">{actionError}</p>
        )}

        <div className="overflow-y-auto px-5 pt-3 pb-5">
          {!entry && (
            <p className="text-zinc-500 text-sm py-4">Loading entry...</p>
          )}
          {entry && !editing && (
            <>
              {media.length > 0 && (
                <div className="mb-3">
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {media.map((m, i) => (
                      <button
                        key={m.path}
                        onClick={() => setLightbox(i)}
                        className="flex-shrink-0 w-16 h-16 bg-zinc-800 rounded-lg border border-zinc-700 overflow-hidden hover:border-zinc-500 transition-colors"
                      >
                        {m.type === "image" ? (
                          <MediaImage src={m.src} alt={m.name} className="w-full h-full object-cover" />
                        ) : (
                          <MediaThumb src={m.src} />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <EntryPreview markdown={entry.rendered_markdown} bare />
            </>
          )}
        </div>
      </div>
      {lightbox !== null && (
        <MediaLightbox items={media} initialIndex={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}
