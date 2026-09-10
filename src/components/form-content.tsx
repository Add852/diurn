"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IntegrationsPanel } from "@/components/integrations-panel";
import { RawContextPanel } from "@/components/raw-context-panel";
import { SkeletonLines } from "@/components/skeleton";
import { EntryDialog } from "@/components/entry-dialog";
import { useToast } from "@/components/toast";
import { localDate } from "@/lib/timezone";

interface FormQuestion {
  identifier: string;
  question: string;
  answer_prompt: string;
}

// Form interface: no LLM calls to render, no session. Raw output writes the
// typed text verbatim into the template slots; AI output refines it per
// answer_prompt. One-big-text (blob) is AI-only — the UI swaps to per-question
// inputs when AI is off (the "fallback" the user specced).
export function FormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlDate = searchParams.get("date") || "";
  const toast = useToast();

  const [date, setDate] = useState(urlDate);
  const [questions, setQuestions] = useState<FormQuestion[]>([]);
  const [askMode, setAskMode] = useState("separate");
  const [formOutput, setFormOutput] = useState("raw");
  const [aiAvailable, setAiAvailable] = useState(false);
  const [integrations, setIntegrations] = useState<Record<string, unknown>>({});
  const [enabledIntegrations, setEnabledIntegrations] = useState<string[]>([]);
  const [rawContext, setRawContext] = useState<any>(null);
  const [contextSources, setContextSources] = useState<Record<string, unknown> | null>(null);
  const [personality, setPersonality] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [blob, setBlob] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "complete" | "error">("loading");
  const [error, setError] = useState("");
  const [viewEntry, setViewEntry] = useState(false);
  const [overwriteConfirm, setOverwriteConfirm] = useState(false);

  const draftKey = `diurn-form-draft-${urlDate}`;
  useEffect(() => {
    const saved = localStorage.getItem(draftKey);
    if (saved) {
      try { setAnswers(JSON.parse(saved)); } catch {}
    }
  }, [draftKey]);
  useEffect(() => {
    const hasText = Object.values(answers).some((v) => v.trim()) || blob.trim();
    if (hasText) localStorage.setItem(draftKey, JSON.stringify({ answers, blob }));
    else localStorage.removeItem(draftKey);
  }, [answers, blob, draftKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/form?${urlDate ? `date=${urlDate}&` : ""}ts=${Date.now()}`);
        const d = await res.json();
        if (cancelled) return;
        if (d.error) {
          setError(d.error);
          setStatus("error");
          return;
        }
        setDate(d.date);
        setQuestions(d.questions || []);
        setAskMode(d.ask_mode);
        setFormOutput(d.form_output);
        setAiAvailable(d.ai_available);
        setPersonality(d.personality || "");
        setEnabledIntegrations(d.enabled_integrations || []);
        setContextSources(d.context_sources || null);
        const ctx = d.context || {};
        setRawContext(ctx);
        const integ: Record<string, unknown> = {};
        for (const key of ["notes", "tasks", "calendar", "media"]) {
          if (d.enabled_integrations?.includes(key) && ctx[key]) integ[key] = ctx[key];
        }
        setIntegrations(integ);
        setStatus("ready");
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || "Failed to load form");
        setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [urlDate]);

  // All-at-once is AI-only (the model splits the blob per question): swap to
  // separate inputs when AI is off.
  const effectiveAskMode = askMode === "all" && !aiAvailable ? "separate" : askMode;

  async function submit(forceOverwrite = false) {
    setStatus("saving");
    setError("");
    try {
      const payload: Record<string, unknown> = {
        date,
        overwrite: forceOverwrite,
        context: rawContext,
        context_sources: contextSources,
      };
      if (effectiveAskMode === "all") payload.blob = blob;
      else payload.answers = answers;

      const res = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
        localStorage.removeItem(draftKey);
        if (d.extraction_warning) toast.show("error", d.extraction_warning);
        if (d.context_saved) toast.show("info", "Raw context saved next to your notes.");
      } else {
        setError(d.error || "Failed to save entry");
        setStatus("ready");
      }
    } catch (err: any) {
      setError(`Failed to save entry: ${err?.message || "network error — is the server running?"}`);
      setStatus("ready");
    }
  }

  const canSubmit =
    effectiveAskMode === "all"
      ? blob.trim().length > 0
      : questions.some((q) => (answers[q.identifier] || "").trim().length > 0);

  const transcript =
    effectiveAskMode === "all"
      ? blob
      : questions.map((q) => `${q.question}\n${answers[q.identifier] || ""}`).join("\n\n---\n\n");

  return (
    <div className="-mx-4 flex h-full flex-col">
      <div className="bg-zinc-950 px-4 pb-2 pt-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-300">{date}</h2>
          {status === "complete" && <span className="text-xs text-emerald-400">Saved</span>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-none px-4 pt-2 pb-4">
        <IntegrationsPanel enabled={enabledIntegrations} data={integrations} />

        {status === "loading" && <SkeletonLines />}

        {status === "error" && <p className="text-red-400 text-sm py-2">{error}</p>}
        {status === "ready" && error && <p className="text-red-400 text-sm py-2">{error}</p>}

        {status === "ready" && (
          <div className="space-y-4">
            {askMode === "all" && !aiAvailable && (
              <p className="text-xs text-amber-400/90 bg-amber-950/30 border border-amber-800/50 rounded-lg px-3 py-2">
                AI is off — the all-at-once input needs AI to split your text per question. Answer each question separately below; your note falls back to raw output.
              </p>
            )}

            {effectiveAskMode === "all" && (
              <div>
                <p className="text-xs text-zinc-500 mb-2">
                  Answer these in one text — AI organizes your input into each question:
                </p>
                <ol className="list-decimal pl-5 space-y-1 text-sm text-zinc-300 mb-3">
                  {questions.map((q) => (
                    <li key={q.identifier}>{q.question}</li>
                  ))}
                </ol>
                <AutoTextarea
                  value={blob}
                  onChange={setBlob}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500 box-border resize-none overflow-y-auto"
                  placeholder="Write freely about your day…"
                />
              </div>
            )}

            {effectiveAskMode === "separate" && (
              <div className="space-y-4">
                {questions.map((q) => (
                  <div key={q.identifier}>
                    <label className="block text-sm text-zinc-300 mb-1">{q.question}</label>
                    <AutoTextarea
                      value={answers[q.identifier] || ""}
                      onChange={(v) => setAnswers((prev) => ({ ...prev, [q.identifier]: v }))}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500 resize-none overflow-y-auto"
                    />
                  </div>
                ))}
              </div>
            )}

            <RawContextPanel
              rawContext={status === "ready" || status === "complete" ? rawContext : null}
              contextSources={contextSources}
              transcript={transcript || undefined}
              uiMode="form"
              askMode={effectiveAskMode}
              questions={questions}
              answers={answers}
              blob={effectiveAskMode === "all" ? blob : undefined}
              personality={personality}
            />
          </div>
        )}

        {status === "complete" && !overwriteConfirm && (
          <div className="flex justify-center mt-4 mb-4 gap-2">
            <button
              onClick={() => setViewEntry(true)}
              className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 text-sm text-zinc-300"
            >
              View entry
            </button>
          </div>
        )}

        {overwriteConfirm && (
          <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4 mb-4">
            <p className="text-sm text-yellow-300 mb-3">
              An entry already exists for {date}. Overwrite it?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => { setOverwriteConfirm(false); submit(true); }}
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

        {viewEntry && (
          <EntryDialog
            date={date}
            onClose={() => setViewEntry(false)}
            onChanged={() => {}}
          />
        )}
      </div>

      {status !== "complete" && status !== "loading" && status !== "error" && (
        <div className="bg-zinc-950 px-4 pt-2 pb-4 border-t border-zinc-800 safe-bottom">
          <button
            onClick={() => submit()}
            disabled={!canSubmit || status === "saving"}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl py-2 text-sm font-medium text-white transition-colors"
          >
            {status === "saving" ? "Saving…" : formOutput === "ai" && aiAvailable ? "Save (AI-polished)" : "Save"}
          </button>
          {status === "ready" && formOutput === "ai" && !aiAvailable && (
            <p className="text-[11px] text-zinc-500 mt-2 text-center">
              AI is off — your raw text is saved verbatim (AI output needs AI enabled).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Auto-growing textarea: starts at 1 line, grows with content up to maxH.
// ponytail: cap via inline max-height; swap for a measured gutter if line
// heights ever vary beyond rem rounding.
function AutoTextarea({
  value,
  onChange,
  className,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 320) + "px";
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={1}
      className={className}
      style={{ maxHeight: 320 }}
    />
  );
}
