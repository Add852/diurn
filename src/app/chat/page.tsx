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
  const urlDate = searchParams.get("date") || "";
  const [date, setDate] = useState(urlDate);

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
  const [enabledIntegrations, setEnabledIntegrations] = useState<string[]>([]);
  const [rawContext, setRawContext] = useState<any>(null);
  const [systemPrompt, setSystemPrompt] = useState("");

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
        setStatus("complete");
      } else {
        setError(d.error || "Failed to generate note");
        setStatus("error");
      }
    } catch {
      setError("Failed to generate note. Try again?");
      setStatus("error");
    }
  }
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const didInit = useRef(false);

  async function initSession() {
    didInit.current = true;
    setStatus("loading");
    setError("");
    setMessages([]);
    setSessionId("");
    setPreview(null);
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
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

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
    <div className="flex flex-col min-h-[calc(100dvh-3.5rem)] -m-4 md:m-0 md:min-h-0">
      <div className="flex-1 px-4 pt-4 pb-2">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-300">{date}</h2>
        {status === "complete" && (
          <span className="text-xs text-emerald-400">Done</span>
        )}
      </div>
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

      {(preview || rawContext) && (
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
        <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:bottom-0 bg-zinc-950/95 backdrop-blur pt-2 pb-4 px-4 border-t border-zinc-800 safe-bottom">
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
        <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:bottom-0 bg-zinc-950/95 backdrop-blur pt-2 pb-4 px-4 border-t border-zinc-800 safe-bottom">
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