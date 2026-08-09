"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EntryDialog } from "@/components/entry-dialog";

function todayIn(timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function HomePage() {
  const [date, setDate] = useState(todayIn());
  const touchedRef = useRef(false);
  const [previewDate, setPreviewDate] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const [profileName, setProfileName] = useState("");
  const [hasEntry, setHasEntry] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHasEntry(null);
    fetch("/api/entries")
      .then((r) => r.json())
      .then((list) => {
        if (cancelled) return;
        setHasEntry(Array.isArray(list) && list.some((e: any) => e.date === date));
      })
      .catch(() => {
        if (!cancelled) setHasEntry(false);
      });
    return () => { cancelled = true; };
  }, [date]);
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.profile) {
          setProfileName(d.profile.name);
          if (d.profile.timezone && !touchedRef.current) setDate(todayIn(d.profile.timezone));
        }
      })
      .catch(() => {});

    fetch("/api/entries?streak=1")
      .then((r) => r.json())
      .then((d) => {
        if (d.streak !== undefined) setStreak(d.streak);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[80dvh] gap-8">
      <div className="flex flex-col items-center gap-3 select-none">
        <div className="flex items-center gap-3" aria-hidden>
          <svg width="52" height="52" viewBox="0 0 44 44" fill="none">
            <rect x="1.5" y="3.5" width="41" height="41" rx="10" fill="#022c22" />
            <g>
              <rect x="6" y="6.5" width="10" height="32" rx="3" fill="#059669" />
              <circle cx="32" cy="23" r="15" fill="#059669" />
              <rect x="5" y="5.5" width="10" height="32" rx="3" fill="#34d399" />
              <circle cx="31" cy="22.5" r="15" fill="#34d399" />
              <circle cx="32" cy="23" r="9.5" fill="#022c22" />
              <path d="M17.5 9a10 10 0 0 1 9-1" stroke="#a7f3d0" strokeOpacity="0.5" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </g>
          </svg>
          <span
            className="text-[34px] leading-none font-semibold tracking-tight text-zinc-100"
            style={{ textShadow: "0 2px 10px rgba(16,185,129,0.25), 0 1px 0 rgba(255,255,255,0.08)" }}
          >
            iurn
          </span>
        </div>
        {profileName && (
          <p className="text-xs text-zinc-500">{profileName}</p>
        )}
      </div>

      <div className="w-full max-w-sm space-y-3">
        <div className="space-y-2">
          <label className="block text-sm text-zinc-400">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => { touchedRef.current = true; setDate(e.target.value); }}
            max={todayIn()}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-zinc-200 [color-scheme:dark]"
          />
          {hasEntry && (
            <p className="text-xs text-zinc-600 flex items-center justify-between">
              <span className="text-emerald-400">Entry exists for this date</span>
              <button
                onClick={() => setPreviewDate(date)}
                className="text-emerald-400 hover:text-emerald-300 underline"
              >
                View entry
              </button>
            </p>
          )}
        </div>
      </div>

      <Link
        href={`/chat?date=${date}`}
        className="w-full max-w-sm bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-3 rounded-xl text-center transition-colors"
      >
        Begin Entry
      </Link>

      <div className="grid grid-cols-2 gap-4 mt-8 text-center">
        <div className="bg-zinc-900 rounded-lg p-4">
          <p className="text-2xl font-bold text-emerald-400">{streak}</p>
          <p className="text-xs text-zinc-500">day streak</p>
        </div>
        <Link
          href="/viewer"
          className="bg-zinc-900 rounded-lg p-4 hover:bg-zinc-800 transition-colors"
        >
          <p className="text-2xl font-bold text-zinc-300">&#8594;</p>
          <p className="text-xs text-zinc-500">view journal</p>
        </Link>
      </div>
      {previewDate && <EntryDialog date={previewDate} onClose={() => setPreviewDate(null)} />}
    </div>
  );
}