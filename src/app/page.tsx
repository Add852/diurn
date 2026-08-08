"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function HomePage() {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [streak, setStreak] = useState(0);
  const [profileName, setProfileName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.profile) {
          setProfileName(d.profile.name);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));

    fetch("/api/entries?streak=1")
      .then((r) => r.json())
      .then((d) => {
        if (d.streak !== undefined) setStreak(d.streak);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] gap-8">
      {streak > 0 && (
        <div className="absolute top-4 left-4 bg-emerald-900/50 border border-emerald-800 rounded-full px-3 py-1 text-xs text-emerald-300 z-30">
          {streak}d streak
        </div>
      )}

      <h1 className="text-xl font-bold text-zinc-200">
        {profileName || "Diurn"}
      </h1>

      <div className="w-full max-w-sm space-y-2">
        <label className="block text-sm text-zinc-400">Date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          max={new Date().toISOString().split("T")[0]}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-zinc-200 [color-scheme:dark]"
        />
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
    </div>
  );
}