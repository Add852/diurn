"use client";

import { useEffect, useRef } from "react";
import { useToast } from "./toast";

// Global "Scanning media..." indicator. Polls /api/media?status=1 every 2s,
// but only shows a toast once (when scanning starts) and dismisses it when
// done. Stays quiet when media is disabled or the folder is missing.
export function ScanIndicator() {
  const { show, dismiss } = useToast();
  const toastId = useRef<number | null>(null);

  useEffect(() => {
    let stop = false;
    async function poll() {
      if (stop) return;
      try {
        const r = await fetch("/api/media?status=1");
        const d = await r.json();
        if (d.scanning && toastId.current === null) {
          toastId.current = show("info", "Scanning media folder...", { sticky: true });
        } else if (!d.scanning && toastId.current !== null) {
          dismiss(toastId.current);
          toastId.current = null;
        }
      } catch {}
    }
    poll();
    const t = setInterval(poll, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [show, dismiss]);

  return null;
}
