"use client";

import { useEffect } from "react";
import { watchSystemTheme } from "@/lib/theme";

// Keeps 'system' theme mode in sync with OS dark/light changes while the
// app is open.
export function ThemeWatcher() {
  useEffect(() => watchSystemTheme(), []);
  return null;
}
