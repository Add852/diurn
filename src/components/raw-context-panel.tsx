"use client";

import { useEffect, useMemo, useState } from "react";
import { settleSystem, settleUser } from "@/lib/prompt";

// Full-transparency panel: everything that feeds the entry — the user's own
// input, the distilled integration sources the AI sees, and the exact prompts
// used to generate each answer. Shown by default; hidden per device via the
// Settings → General toggle (localStorage diurn-show-context).
export function RawContextPanel({
  rawContext,
  contextSources,
  systemPrompt,
  transcript,
  uiMode,
  askMode,
  questions,
  answers,
  blob,
  personality,
}: {
  rawContext: any;
  contextSources?: Record<string, unknown> | null;
  systemPrompt?: string;
  transcript?: string;
  uiMode?: string;
  askMode?: string;
  questions?: { identifier: string; question: string; answer_prompt?: string }[];
  answers?: Record<string, string>;
  blob?: string;
  personality?: string;
}) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    setShow(localStorage.getItem("diurn-show-context") !== "0");
  }, []);
  if (!show || !rawContext) return null;

  const sources = contextSources ?? null;
  const integrationContext = sources
    ? `\n\n--- Context ---\n${JSON.stringify(sources, null, 2)}\n---`
    : "";

  // Mirrors the settle() prompt in entries POST byte-for-byte so the panel
  // shows exactly what the AI receives per question.
  const prompts = useMemo(() => (questions || []).map((q) => ({
    identifier: q.identifier,
    system: settleSystem(personality),
    user: settleUser(q, integrationContext, transcript ?? ""),
  })), [questions, integrationContext, transcript, personality]);

  return (
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
        {transcript && (
          <div>
            <p className="text-zinc-600 mb-1 font-medium">Your input{uiMode === "chat" ? " (transcript)" : askMode === "all" ? " (one text)" : " (per question)"}</p>
            <pre className="whitespace-pre-wrap bg-zinc-900 rounded p-2 overflow-x-auto">{transcript}</pre>
          </div>
        )}
        {sources && (
          <div>
            <p className="text-zinc-600 mb-1 font-medium">Integration sources fed to the AI (JSON)</p>
            <pre className="whitespace-pre-wrap bg-zinc-900 rounded p-2 overflow-x-auto">{JSON.stringify(sources, null, 2)}</pre>
          </div>
        )}
        {prompts.length > 0 && (
          <div>
            <p className="text-zinc-600 mb-1 font-medium">AI prompts used to generate answers</p>
            <div className="space-y-2">
              {prompts.map((p) => (
                <details key={p.identifier} className="bg-zinc-900 border border-zinc-800 rounded p-2">
                  <summary className="cursor-pointer text-zinc-500">{p.identifier}</summary>
                  <pre className="whitespace-pre-wrap bg-zinc-950 rounded p-2 mt-2 overflow-x-auto">{`system: ${p.system}\n\nuser: ${p.user}`}</pre>
                </details>
              ))}
            </div>
          </div>
        )}
        {rawContext.notes?.length > 0 && (
          <div>
            <p className="text-zinc-600 mb-1 font-medium">Notes ({rawContext.notes.length})</p>
            <pre className="whitespace-pre-wrap bg-zinc-900 rounded p-2 overflow-x-auto">{JSON.stringify(rawContext.notes, null, 2)}</pre>
          </div>
        )}
        {rawContext.tasks?.tasks?.length > 0 && (
          <div>
            <p className="text-zinc-600 mb-1 font-medium">Tasks ({rawContext.tasks.tasks.length})</p>
            <pre className="whitespace-pre-wrap bg-zinc-900 rounded p-2 overflow-x-auto">{JSON.stringify(rawContext.tasks, null, 2)}</pre>
          </div>
        )}
        {rawContext.calendar?.events?.length > 0 && (
          <div>
            <p className="text-zinc-600 mb-1 font-medium">Calendar ({rawContext.calendar.events.length})</p>
            <pre className="whitespace-pre-wrap bg-zinc-900 rounded p-2 overflow-x-auto">{JSON.stringify(rawContext.calendar, null, 2)}</pre>
          </div>
        )}
        {/* Media shown only when it's actually fed to the AI (media_in_context on);
            the UI thumbnail gallery is a display feature, not AI context. */}
        {Array.isArray((sources?.media as unknown[]) || undefined) && (sources!.media as unknown[]).length > 0 && (
          <div>
            <p className="text-zinc-600 mb-1 font-medium">Media ({(sources!.media as unknown[]).length})</p>
            <pre className="whitespace-pre-wrap bg-zinc-900 rounded p-2 overflow-x-auto">{JSON.stringify(rawContext.media, null, 2)}</pre>
          </div>
        )}
      </div>
    </details>
  );
}
