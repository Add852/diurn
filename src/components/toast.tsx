"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

export type ToastKind = "info" | "success" | "error";
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  sticky?: boolean; // no auto-dismiss; caller must dismiss()
}

interface ToastCtx {
  toasts: Toast[];
  show: (kind: ToastKind, message: string, opts?: { sticky?: boolean; ms?: number }) => number;
  dismiss: (id: number) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function useToast() {
  const t = useContext(Ctx);
  if (!t) throw new Error("useToast must be used inside <ToastProvider>");
  return t;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((kind: ToastKind, message: string, opts?: { sticky?: boolean; ms?: number }) => {
    const id = nextId.current++;
    const sticky = opts?.sticky ?? kind === "error";
    const ms = opts?.ms ?? 2500;
    setToasts((prev) => [...prev, { id, kind, message, sticky }]);
    if (!sticky) setTimeout(() => dismiss(id), ms);
    return id;
  }, [dismiss]);

  return (
    <Ctx.Provider value={{ toasts, show, dismiss }}>
      {children}
      {/* Toasts: top-right, below the desktop sidebar edge, above everything. */}
      <div aria-live="polite" className="fixed top-3 right-3 z-[90] flex flex-col gap-2 items-end max-w-[calc(100vw-6rem)] md:max-w-sm">
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={`text-left text-xs px-3 py-2 rounded-lg border shadow-lg backdrop-blur max-w-full animate-[toast-in_.15s_ease-out] ${
              t.kind === "error"
                ? "bg-red-950/90 border-red-700 text-red-200"
                : t.kind === "success"
                  ? "bg-emerald-950/90 border-emerald-700 text-emerald-200"
                  : "bg-zinc-900/95 border-zinc-700 text-zinc-300"
            }`}
          >
            {t.kind === "info" && t.sticky && <span className="inline-block animate-pulse mr-1.5">⏳</span>}
            {t.message}
          </button>
        ))}
      </div>
    </Ctx.Provider>
  );
}
