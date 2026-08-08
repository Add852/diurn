"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { JournalView } from "./journal-view";
import { MediaView } from "./media-view";

function ViewerContent({ initialMode }: { initialMode: "journal" | "media" }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mode, setMode] = useState<"journal" | "media">(initialMode);

  useEffect(() => {
    const m = searchParams.get("mode");
    if (m === "media" || m === "journal") setMode(m);
  }, [searchParams]);

  function setModeAndUrl(next: "journal" | "media") {
    setMode(next);
    router.replace(`/viewer?mode=${next}`, { scroll: false });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 w-fit">
        <button
          onClick={() => setModeAndUrl("journal")}
          className={`px-3 py-1 text-xs rounded-md transition-colors ${mode === "journal" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
        >
          Journal
        </button>
        <button
          onClick={() => setModeAndUrl("media")}
          className={`px-3 py-1 text-xs rounded-md transition-colors ${mode === "media" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
        >
          Media
        </button>
      </div>

      {mode === "journal" ? <JournalView /> : <MediaView />}
    </div>
  );
}

export default function ViewerPage() {
  return (
    <Suspense fallback={<p className="text-zinc-500 text-sm py-8 text-center">Loading...</p>}>
      <ViewerContentFromSearch />
    </Suspense>
  );
}

function ViewerContentFromSearch() {
  const searchParams = useSearchParams();
  const m = searchParams.get("mode");
  const mode: "journal" | "media" = m === "media" ? "media" : "journal";
  return <ViewerContent initialMode={mode} />;
}
