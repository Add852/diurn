"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EntryDialog } from "@/components/entry-dialog";
import { IntegrationsPanel } from "@/components/integrations-panel";
import { SkeletonLines } from "@/components/skeleton";
import { useToast } from "@/components/toast";

interface Message {
  id: number;
  role: string;
  content: string;
}

function ChatContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlDate = searchParams.get("date") || "";
  const [date, setDate] = useState(urlDate);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<
    "loading" | "awaiting_input" | "thinking" | "generating" | "complete" | "error"
  >("loading");
  const [sessionId, setSessionId] = useState("");
  const [error, setError] = useState("");
  const [viewEntry, setViewEntry] = useState(false);
  const [overwriteConfirm, setOverwriteConfirm] = useState(false);
  const [integrations, setIntegrations] = useState<Record<string, any>>({});
  const [enabledIntegrations, setEnabledIntegrations] = useState<string[]>([]);
  const [rawContext, setRawContext] = useState<any>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const toast = useToast();

  // Draft + active-session guards: typed-but-unsent text and an in-progress
  // conversation are easy to lose by navigating away (nav bar / back button /
  // tab close). Warn before both; keep the draft in localStorage so a
  // deliberate reload restores it.
  const draftKey = `diurn-chat-draft-${urlDate}`;
  useEffect(() => {
    const saved = localStorage.getItem(draftKey);
    if (saved && !input) setInput(saved);
  }, [draftKey]);
  useEffect(() => {
    if (input) localStorage.setItem(draftKey, input);
    else localStorage.removeItem(draftKey);
  }, [input, draftKey]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      const inProgress = status === "awaiting_input" || status === "thinking" || status === "generating";
      if (!input.trim() && !inProgress) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [input, status]);
  // In-app navigation (nav bar / in-page links): confirm before leaving a
  // session in progress — the conversation can't be resumed from another page.
  useEffect(() => {
    const inProgress = () => status === "awaiting_input" || status === "thinking" || status === "generating";
    const onClick = (e: MouseEvent) => {
      if (!inProgress() && !input.trim()) return;
      const a = (e.target as HTMLElement).closest?.("a") as HTMLAnchorElement | null;
      const href = a?.getAttribute("href");
      if (!a || !href || a.target === "_blank") return;
      if (a.closest("nav") || href.startsWith("/")) {
        if (!confirm("Leave this chat session? Unsent text is kept, but the conversation will need a new session.")) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [input, status]);

  async function generateNote(forceOverwrite = false) {
    setStatus("generating");
    try {
      const res = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, date, overwrite: forceOverwrite }),
      });
      const d = await res.json();

      if (d.exists) {
        setOverwriteConfirm(true);
        setStatus("complete");
        return;
      }

      if (d.rendered) {
        setOverwriteConfirm(false);
        setStatus("complete");
        if (d.extraction_warning) toast.show("error", d.extraction_warning);
      } else {
        setError(d.error || "Failed to generate note");
        setStatus("error");
      }
    } catch {
      setError("Failed to generate note. Try again?");
      setStatus("error");
    }
  }

  // Entry edited or deleted from the viewing dialog — if it no longer
  // exists, let the user generate again.
  async function handleEntryChanged() {
    try {
      const r = await fetch(`/api/entries?date=${encodeURIComponent(date)}`);
      const list = await r.json();
      if (Array.isArray(list) && !list.some((e) => e.date === date)) {
        setStatus("awaiting_input");
        setOverwriteConfirm(false);
      }
    } catch {}
  }
  const scrollerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const didInit = useRef(false);
  const stuck = useRef(true); // pinned to bottom until the user scrolls up

  async function initSession() {
    didInit.current = true;
    setStatus("loading");
    setError("");
    setMessages([]);
    setSessionId("");
    setViewEntry(false);
    setRawContext(null);
    setIntegrations({});
    setEnabledIntegrations([]);
    setSystemPrompt("");

    try {
      const res = await fetch(`/api/chat?${urlDate ? `date=${urlDate}&` : ""}ts=${Date.now()}`);
      const d = await res.json();
      if (d.error) {
        setError(d.error);
        setStatus("error");
      } else if (d.messages) {
        setDate(d.date || date);
        setMessages(d.messages.filter((m: any) => m.role !== "system"));
        setSessionId(d.session_id);
        setStatus("awaiting_input");
        const enabled = d.enabled_integrations || [];
        setEnabledIntegrations(enabled);
        const ctx = d.context || {};
        setRawContext(ctx);
        setSystemPrompt(d.messages.find((m: any) => m.role === "system")?.content || "");
        const integ: Record<string, unknown> = {};
        if (enabled.includes("notes") && ctx.notes) integ.notes = ctx.notes;
        if (enabled.includes("tasks") && ctx.tasks) integ.tasks = ctx.tasks;
        if (enabled.includes("calendar") && ctx.calendar) integ.calendar = ctx.calendar;
        if (enabled.includes("media") && ctx.media) integ.media = ctx.media;
        setIntegrations(integ);
      } else {
        setError("Unknown response");
        setStatus("error");
      }
    } catch (err: any) {
      setError(err.message || "Failed to start session");
      setStatus("error");
    }
  }
  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
    if (stuck.current) sc.scrollTop = sc.scrollHeight;
  }, [messages, status]);

  // While pinned, keep following new content; release the moment the user
  // scrolls up away from the bottom, re-pin when they come back down.
  // Also re-pin when the viewport shrinks (mobile keyboard with
  // interactive-widget=resizes-content): the scroller gets shorter and the
  // latest message would otherwise drop out of view.
  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
    const onScroll = () => {
      stuck.current = sc.scrollHeight - sc.scrollTop - sc.clientHeight <= 80;
    };
    const onResize = () => {
      if (!stuck.current) return;
      requestAnimationFrame(() => {
        if (stuck.current) sc.scrollTop = sc.scrollHeight;
      });
    };
    sc.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      sc.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    if (didInit.current) return;
    initSession();
  }, []);


  async function sendMessage() {
    if (!input.trim() || status === "thinking" || status === "generating") return;
    if (!sessionId) {
      setError("Session lost. Please reload.");
      setStatus("error");
      return;
    }

    setStatus("thinking");
    setError("");

    const userMsg = input;
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setMessages((prev) => [...prev, { id: Date.now(), role: "user", content: userMsg }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, message: userMsg }),
      });
      const d = await res.json();

      if (d.messages) {
        setMessages(
          d.messages.filter((m: any) => m.role !== "system") as Message[]
        );
      }

      if (d.status === "complete") {
        setStatus("generating");
        generateNote();
      } else {
        setStatus("awaiting_input");
      }
    } catch {
      setError("Connection failed. Try again.");
      setStatus("awaiting_input");
    }
  }
  return (
    <div className="-mx-4 flex h-full flex-col">
      <div className="bg-zinc-950 px-4 pb-2 pt-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-300">{date}</h2>
        {status === "complete" && (
          <span className="text-xs text-emerald-400">Done</span>
        )}
      </div>
      </div>

      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto overscroll-none px-4 pt-2 pb-4">
      <IntegrationsPanel enabled={enabledIntegrations} data={integrations} />

      <div className="space-y-4 mb-4">
        {status === "loading" && (
          <p className="text-zinc-500 text-sm animate-pulse">Setting up...</p>
        )}
        {status === "error" && !messages.length && (
          <p className="text-red-400 text-sm">{error}</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`${m.role === "user" ? "ml-8" : "mr-8"}`}>
            <div
              className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-emerald-900/40 text-emerald-100"
                  : "bg-zinc-800 text-zinc-300"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {status === "thinking" && (
          <div className="mr-8">
            <div className="bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-500 animate-pulse">
              ...
            </div>
          </div>
        )}
        {status === "generating" && (
          <div className="mr-8">
            <div className="bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-500 animate-pulse">
              Generating your daily note...
            </div>
          </div>
        )}
        {error && status === "error" && (
          <div className="text-sm text-center py-2">
            <span className="text-red-400">{error}</span>
            {" "}
            <button onClick={initSession} className="text-emerald-400 underline text-xs">
              Retry
            </button>
          </div>
        )}
      </div>

      {overwriteConfirm && (
        <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4 mb-4">
          <p className="text-sm text-yellow-300 mb-3">
            An entry already exists for {date}. Overwrite it?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => { setOverwriteConfirm(false); generateNote(true); }}
              className="bg-yellow-600 hover:bg-yellow-500 rounded-lg px-4 py-2 text-sm font-medium text-white"
            >
              Overwrite
            </button>
            <button
              onClick={() => { setOverwriteConfirm(false); setStatus("complete"); }}
              className="bg-zinc-700 hover:bg-zinc-600 rounded-lg px-4 py-2 text-sm text-zinc-300"
            >
              Keep existing
            </button>
          </div>
        </div>
      )}

      {status === "complete" && !overwriteConfirm && (
        <div className="flex justify-center mb-4">
          <button
            onClick={() => setViewEntry(true)}
            className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-sm font-medium text-white"
          >
            View entry
          </button>
        </div>
      )}

      {(status === "complete" || rawContext) && (
        <details className="mb-4 bg-zinc-950 border border-zinc-800 rounded-lg p-3">
          <summary className="text-xs text-zinc-500 cursor-pointer list-none">
            Raw context &amp; input (debug)
          </summary>
          <div className="mt-3 space-y-3 text-xs text-zinc-500">
            {systemPrompt && (
              <div>
                <p className="text-zinc-600 mb-1 font-medium">System prompt sent to the bot</p>
                <pre className="whitespace-pre-wrap bg-zinc-900 rounded p-2 overflow-x-auto">{systemPrompt}</pre>
              </div>
            )}
            {messages.filter((m) => m.role === "user").length > 0 && (
              <div>
                <p className="text-zinc-600 mb-1 font-medium">User input transcript</p>
                <pre className="whitespace-pre-wrap bg-zinc-900 rounded p-2 overflow-x-auto">
{messages.filter((m) => m.role === "user").map((m) => m.content).join("\n\n---\n\n")}
                </pre>
              </div>
            )}
            {rawContext?.notes?.length > 0 && (
              <div>
                <p className="text-zinc-600 mb-1 font-medium">Notes ({rawContext.notes.length})</p>
                <pre className="whitespace-pre-wrap bg-zinc-900 rounded p-2 overflow-x-auto">
{JSON.stringify(rawContext.notes, null, 2)}
                </pre>
              </div>
            )}
            {rawContext?.tasks?.length > 0 && (
              <div>
                <p className="text-zinc-600 mb-1 font-medium">Tasks ({rawContext.tasks.length})</p>
                <pre className="whitespace-pre-wrap bg-zinc-900 rounded p-2 overflow-x-auto">
{JSON.stringify(rawContext.tasks, null, 2)}
                </pre>
              </div>
            )}
            {rawContext?.calendar?.length > 0 && (
              <div>
                <p className="text-zinc-600 mb-1 font-medium">Calendar ({rawContext.calendar.length})</p>
                <pre className="whitespace-pre-wrap bg-zinc-900 rounded p-2 overflow-x-auto">
{JSON.stringify(rawContext.calendar, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </details>
      )}

      </div>
      {status !== "complete" && (
        <div className="bg-zinc-950 px-4 pt-2 pb-4 border-t border-zinc-800 safe-bottom">
          <form
            onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
            className="flex gap-2"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onInput={(e) => {
                const t = e.currentTarget;
                t.style.height = "auto";
                t.style.height = Math.min(t.scrollHeight, 160) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              rows={1}
              placeholder="Type your answer..."
              disabled={status === "loading" || status === "thinking" || status === "generating"}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500 disabled:opacity-50 placeholder:text-zinc-500 box-border resize-none overflow-y-auto max-h-40"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 rounded-full px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      )}

      {status === "complete" && (
        <div className="bg-zinc-950 px-4 pt-2 pb-4 border-t border-zinc-800 safe-bottom">
          <div className="flex gap-2">
          <button
            onClick={() => { localStorage.removeItem(draftKey); router.push("/"); }}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 rounded-xl py-2 text-sm font-medium transition-colors"
          >
            Done
          </button>
          </div>
        </div>
      )}
      {viewEntry && (
        <EntryDialog date={date} onClose={() => setViewEntry(false)} onChanged={handleEntryChanged} />
      )}
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<SkeletonLines />}>
      <ChatContent />
    </Suspense>
  );
}