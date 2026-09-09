"use client";

import { useEffect, useState } from "react";

// Debug/dump panel for the day's raw context. Shown by default; hidden per
// device via the Settings → General toggle (localStorage diurn-show-context).
export function RawContextPanel({
  rawContext,
  systemPrompt,
  transcript,
}: {
  rawContext: any;
  systemPrompt?: string;
  transcript?: string;
}) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    setShow(localStorage.getItem("diurn-show-context") !== "0");
  }, []);
  if (!show || !rawContext) return null;

  const sections: { label: string; data: unknown }[] = [];
  if (systemPrompt) sections.push({ label: "System prompt sent to the bot", data: systemPrompt });
  if (transcript) sections.push({ label: "User input transcript", data: transcript });
  if (rawContext.notes?.length > 0) sections.push({ label: `Notes (${rawContext.notes.length})`, data: rawContext.notes });
  if (rawContext.tasks?.tasks?.length > 0) sections.push({ label: `Tasks (${rawContext.tasks.tasks.length})`, data: rawContext.tasks });
  if (rawContext.calendar?.events?.length > 0) sections.push({ label: `Calendar (${rawContext.calendar.events.length})`, data: rawContext.calendar });
  if (rawContext.media?.files?.length > 0) sections.push({ label: `Media (${rawContext.media.files.length})`, data: rawContext.media });
  if (sections.length === 0) return null;

  return (
    <details className="mb-4 bg-zinc-950 border border-zinc-800 rounded-lg p-3">
      <summary className="text-xs text-zinc-500 cursor-pointer list-none">
        Raw context &amp; input (debug)
      </summary>
      <div className="mt-3 space-y-3 text-xs text-zinc-500">
        {sections.map((s) => (
          <div key={s.label}>
            <p className="text-zinc-600 mb-1 font-medium">{s.label}</p>
            <pre className="whitespace-pre-wrap bg-zinc-900 rounded p-2 overflow-x-auto">
              {typeof s.data === "string" ? s.data : JSON.stringify(s.data, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </details>
  );
}
