"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { JournalView } from "./journal-view";
import { MediaView } from "./media-view";
import { SkeletonLines } from "@/components/skeleton";

type Mode = "journal" | "media";

// Tab switch is pure client state: no router.replace (that refetched the RSC
// payload per click) and no unmount/remount of the views (that refetched
// entries + all thumbnails per click). Both views stay mounted once opened;
// the inactive one is hidden via content-visibility — state and scroll
// position are preserved, and its render/paint work is skipped entirely.
function ViewerContent({ initialMode }: { initialMode: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  // Lazy-mount: a view fetches its data the first time it's opened, never
  // re-fetches on tab switches after that.
  const [mounted, setMounted] = useState<Mode[]>([initialMode]);

  function switchMode(next: Mode) {
    setMode(next);
    if (!mounted.includes(next)) setMounted((m) => [...m, next]);
  }

  return (
    <div className="-mx-4 flex h-full flex-col">
      <div className="bg-zinc-950 px-4 pb-3">
        <div className="flex w-fit items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
          <button
            onClick={() => switchMode("journal")}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${mode === "journal" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            Journal
          </button>
          <button
            onClick={() => switchMode("media")}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${mode === "media" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            Media
          </button>
        </div>
      </div>

      {/* Each view owns its scroll container. visibility (not content-
          visibility: hidden — that skips layout, collapsing scrollHeight and
          losing scroll position) keeps the inactive view's boxes laid out, so
          its scrollTop survives tab switches, while paint is skipped. */}
      <div className="relative min-h-0 flex-1">
      {mounted.includes("journal") && (
        <div
          className="absolute inset-0 overflow-y-auto overscroll-none px-4 pb-4"
          style={mode === "journal" ? undefined : { visibility: "hidden", pointerEvents: "none" }}
        >
          <JournalView />
        </div>
      )}
      {mounted.includes("media") && (
        <div
          className="absolute inset-0 overflow-y-auto overscroll-none px-4 pb-4"
          style={mode === "media" ? undefined : { visibility: "hidden", pointerEvents: "none" }}
        >
          <MediaView />
        </div>
      )}
      </div>
    </div>
  );
}

function ViewerContentFromSearch() {
  const searchParams = useSearchParams();
  const m = searchParams.get("mode");
  const mode: Mode = m === "media" ? "media" : "journal";
  return <ViewerContent initialMode={mode} />;
}

export default function ViewerPage() {
  return (
    <Suspense fallback={<SkeletonLines />}>
      <ViewerContentFromSearch />
    </Suspense>
  );
}
