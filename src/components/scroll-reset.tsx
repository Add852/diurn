"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

// main is the scroll container; Next's window scroll restoration never touches
// it, so reset to top on route changes.
export function ScrollReset() {
  const pathname = usePathname();
  useEffect(() => {
    document.querySelector("main")?.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}