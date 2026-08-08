"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EntryPreview } from "@/components/entry-preview";
import { IntegrationsPanel } from "@/components/integrations-panel";

interface Message {
  id: number;
  role: string;
  content: string;
}

function ChatContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0];

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<
    "loading" | "awaiting_input" | "thinking" | "generating" | "complete" | "error"
  >("loading");
  const [sessionId, setSessionId] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ rendered: string } | null>(null);
  const [overwriteConfirm, setOverwriteConfirm] = useState(false);
  const [integrations, setIntegrations] = useState<Record<string, any>>({});

  function loadIntegrations(enabled: string[]) {
    const endpoints: Record<string, string> = {
      media: `/api/media?date=${date}&limit=20`,
      tasks: "/api/integrations/tasks/status",
      calendar: "/api/integrations/calendar/status",
    };

    const fetchers: Promise<[string, any]>[] = enabled
      .filter((k) => endpoints[k])
      .map((k) => fetch(`${endpoints[k]}?date=${date}`).then((r) => r.json()).then((d) => [k, d] as const));

    if (fetchers.length === 0) {
      setIntegrations({});
      return;
    }

    Promise.all(fetchers).then((results) => {
      const map: Record<string, any> = {};
      for (const [key, val] of results) map[key] = val;
      setIntegrations(map);
    }).catch(() => {});
  }

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
        setPreview({ rendered: d.rendered });
        setOverwriteConfirm(false);
      } else {
        setError(d.error || "Failed to generate note");
      }
    } catch {
      setError("Failed to generate note. Try again?");
    } finally {
      setStatus("complete");
    }
  }
  const endRef = useRef<HTMLDivElement>(null);
  const didInit = useRef(false);

  async function initSession() {
    didInit.current = true;
    setStatus("loading");
    setError("");
    setMessages([]);
    setSessionId("");
    setPreview(null);

    try {
      const res = await fetch(`/api/chat?date=${date}&ts=${Date.now()}`);
      const d = await res.json();
      if (d.error) {
        setError(d.error);
        setStatus("error");
      } else if (d.messages) {
        setMessages(d.messages.filter((m: any) => m.role !== "system"));
        setSessionId(d.session_id);
        setStatus("awaiting_input");
        loadIntegrations(d.enabled_integrations || []);
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
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    if (didInit.current) return;
    initSession();
  }, []);

  useEffect(() => {
    const update = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--vvh", `${h}px`);
    };
    update();
    window.visualViewport?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    return () => {
      window.visualViewport?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
    };
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
    <div className="md:contents flex flex-col chat-fill -mx-4 -mt-4">
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2 min-h-0">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-300">{date}</h2>
        {status === "complete" && (
          <span className="text-xs text-emerald-400">Done</span>
        )}
      </div>

      {Object.keys(integrations).length > 0 && (
        <IntegrationsPanel integrations={integrations} />
      )}

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
        <div ref={endRef} />
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

      {preview && (
        <EntryPreview markdown={preview.rendered} collapsible defaultCollapsed />
      )}

      </div>

      {status !== "complete" && (
        <div className="flex-shrink-0 bg-zinc-950/95 backdrop-blur pt-2 pb-4 px-4 border-t border-zinc-800 safe-bottom">
          <form
            onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
            className="flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your answer..."
              disabled={status === "loading" || status === "thinking" || status === "generating"}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-full px-4 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500 disabled:opacity-50 placeholder:text-zinc-500 box-border"
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
        <div className="flex-shrink-0 bg-zinc-950/95 backdrop-blur pt-2 pb-4 px-4 border-t border-zinc-800 safe-bottom">
          <div className="flex gap-2">
          <button
            onClick={() => router.push("/")}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 rounded-xl py-2 text-sm font-medium transition-colors"
          >
            Done
          </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<p className="text-zinc-500 text-sm py-8 text-center">Loading...</p>}>
      <ChatContent />
    </Suspense>
  );
}