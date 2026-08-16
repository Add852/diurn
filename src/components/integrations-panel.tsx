"use client";

import { useState } from "react";
import { MediaThumb } from "@/components/media-thumb";
import { MediaLightbox, type MediaItem } from "@/components/media-lightbox";

const DEFAULT_LIMIT = 5;

function countFor(key: string, data: any): number {
  if (key === "media") return data.media?.files?.length ?? 0;
  if (key === "notes") return data.notes?.length ?? 0;
  return data[key]?.[key]?.length ?? 0;
}

function ShowAll({ expanded, total, onToggle }: { expanded: boolean; total: number; onToggle: () => void }) {
  if (total <= DEFAULT_LIMIT) return null;
  return (
    <button onClick={onToggle} className="text-[11px] text-zinc-500 hover:text-zinc-300 underline mt-1">
      {expanded ? "Show less" : `Show all (${total})`}
    </button>
  );
}

export function IntegrationsPanel({
  enabled,
  data,
}: {
  enabled: string[];
  data: Record<string, any>;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (enabled.length === 0) return null;

  const total = enabled.reduce((acc, key) => acc + countFor(key, data), 0);
  const hasContent = enabled.some((key) => countFor(key, data) > 0);
  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="mb-4 bg-zinc-900 border border-zinc-800 rounded-lg p-3">
      <details open>
        <summary className="text-xs text-zinc-500 cursor-pointer flex items-center gap-2 list-none">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          Today&rsquo;s context
          <span className="text-[10px] text-zinc-600">({total})</span>
        </summary>

        <div className="mt-2 space-y-3">
          {!hasContent && enabled.every((k) => data[k] !== undefined) && (
            <p className="text-xs text-zinc-600">No context available for today.</p>
          )}

          {enabled.map((key) => {
            if (data[key] === undefined) {
              return (
                <div key={key} className="flex items-center gap-2 text-xs text-zinc-600">
                  <span className="w-3 h-3 rounded-full bg-zinc-800 animate-pulse" />
                  <span className="capitalize">{key} loading&hellip;</span>
                </div>
              );
            }
            return <Section key={key} kind={key} value={data[key]} expanded={!!expanded[key]} onToggle={() => toggle(key)} />;
          })}
        </div>
      </details>
    </div>
  );
}

function Section({ kind, value, expanded, onToggle }: { kind: string; value: any; expanded: boolean; onToggle: () => void }) {
  if (kind === "media") return <MediaSection value={value} />;
  if (kind === "notes") return <NotesSection value={value} expanded={expanded} onToggle={onToggle} />;
  if (kind === "tasks") return <TasksSection value={value} expanded={expanded} onToggle={onToggle} />;
  if (kind === "calendar") return <CalendarSection value={value} expanded={expanded} onToggle={onToggle} />;
  return null;
}

function NotesSection({ value, expanded, onToggle }: { value: any; expanded: boolean; onToggle: () => void }) {
  const notes: any[] = Array.isArray(value) ? value : value?.notes ?? [];
  return (
    <div>
      <p className="text-xs text-zinc-500 mb-1">Notes &middot; {notes.length}</p>
      {notes.length === 0 ? (
        <p className="text-xs text-zinc-600">No notes for today.</p>
      ) : (
        <div className="space-y-1">
          {(expanded ? notes : notes.slice(0, DEFAULT_LIMIT)).map((n, i) => (
            <div key={i} className="text-xs text-zinc-300">
              <span className="font-medium">{n.name}</span>
              {n.summary ? <span className="text-zinc-500"> &mdash; {n.summary}</span> : null}
            </div>
          ))}
        </div>
      )}
      <ShowAll expanded={expanded} total={notes.length} onToggle={onToggle} />
    </div>
  );
}

function MediaSection({ value }: { value: any }) {
  const files: MediaItem[] = value?.files ?? [];
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  if (files.length === 0) {
    return <p className="text-xs text-zinc-600">No media taken today.</p>;
  }
  return (
    <div>
      <p className="text-xs text-zinc-500 mb-1">Media &middot; {files.length} files</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {files.map((m, i) => (
          <button
            key={m.path}
            onClick={() => setLightboxIndex(i)}
            className="flex-shrink-0 w-14 h-14 bg-zinc-800 rounded-lg border border-zinc-700 overflow-hidden hover:border-zinc-500 transition-colors"
          >
            {m.type === "image" ? (
              <img src={m.src} alt={m.name} className="w-full h-full object-cover" loading="lazy" />
            ) : (
              <MediaThumb src={m.src} iconClass="w-3 h-3" />
            )}
          </button>
        ))}
      </div>
      {lightboxIndex !== null && (
        <MediaLightbox items={files} initialIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      )}
    </div>
  );
}

function TasksSection({ value, expanded, onToggle }: { value: any; expanded: boolean; onToggle: () => void }) {
  const tasks: any[] = value?.tasks ?? [];
  if (value?.connected === false) {
    const reason = value?.reason;
    return (
      <p className="text-xs text-zinc-600">
        Google Tasks {reason === "not_authenticated" ? "not connected" : `unavailable (${reason})`} &mdash; set up in{" "}
        <a href="/settings" className="text-zinc-400 underline">Settings</a>
      </p>
    );
  }
  if (tasks.length === 0) {
    return <p className="text-xs text-zinc-600">No tasks completed today.</p>;
  }
  return (
    <div>
      <p className="text-xs text-zinc-500 mb-1">{tasks.length} task/s</p>
      <div className="space-y-0.5">
        {(expanded ? tasks : tasks.slice(0, DEFAULT_LIMIT)).map((t: any, i: number) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${t.status === "completed" ? "bg-emerald-500" : "bg-yellow-500"}`} />
            <span className="min-w-0">
              <span className="text-zinc-300 truncate block">{t.title}</span>
              {t.description && <span className="text-zinc-600 truncate block">{t.description}</span>}
            </span>
            <span className="text-zinc-600 ml-auto flex-shrink-0">{t.listName}</span>
          </div>
        ))}
      </div>
      <ShowAll expanded={expanded} total={tasks.length} onToggle={onToggle} />
    </div>
  );
}

function CalendarSection({ value, expanded, onToggle }: { value: any; expanded: boolean; onToggle: () => void }) {
  const events: any[] = value?.events ?? [];
  if (value?.connected === false) {
    const reason = value?.reason;
    return (
      <p className="text-xs text-zinc-600">
        Google Calendar {reason === "not_authenticated" ? "not connected" : `unavailable (${reason})`} &mdash; set up in{" "}
        <a href="/settings" className="text-zinc-400 underline">Settings</a>
      </p>
    );
  }
  if (events.length === 0) {
    return <p className="text-xs text-zinc-600">No events for today.</p>;
  }
  return (
    <div>
      <p className="text-xs text-zinc-500 mb-1">Calendar &middot; {events.length} events</p>
      <div className="space-y-0.5">
        {(expanded ? events : events.slice(0, DEFAULT_LIMIT)).map((e: any, i: number) => (
          <div key={i} className="text-xs text-zinc-300 min-w-0">
            {e.start?.slice(11, 16) && <span className="text-zinc-600 mr-1">{e.start.slice(11, 16)}</span>}
            <span className="truncate block">{e.summary}</span>
            {e.description && <span className="text-zinc-600 truncate block">{e.description}</span>}
          </div>
        ))}
      </div>
      <ShowAll expanded={expanded} total={events.length} onToggle={onToggle} />
    </div>
  );
}