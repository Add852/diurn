"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { parseFrontmatter } from "@/lib/frontmatter";


export function fmt(value: any): string {
  if (value === true) return "yes";
  if (value === false) return "no";
  return String(value);
}

interface EntryPreviewProps {
  markdown: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  /** Dialog context: skip the card frame — the dialog is the frame. */
  bare?: boolean;
}

export function EntryPreview({ markdown, collapsible, defaultCollapsed, bare }: EntryPreviewProps) {
  const { data, body } = parseFrontmatter(markdown);
  const hasFM = Object.keys(data).length > 0;
  const [collapsed, setCollapsed] = useState(!!defaultCollapsed);

  const inner = (
    <>
      {hasFM && (
        <div className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1.5 bg-zinc-800/50 rounded-lg p-3">
          {Object.entries(data).map(([key, value]) => (
            <div key={key} className="flex justify-between items-center min-w-0">
              <span className="text-xs text-zinc-500 truncate">{key}</span>
              <span className="text-xs text-zinc-200 font-medium ml-2">{fmt(value)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="prose prose-sm max-w-none prose-headings:text-zinc-100 prose-p:text-zinc-200 prose-strong:text-zinc-100 prose-a:text-emerald-400 prose-code:text-zinc-200 prose-blockquote:text-zinc-400 prose-li:text-zinc-200">
        <ReactMarkdown>{body}</ReactMarkdown>
      </div>
    </>
  );

  const frame = bare ? "" : "bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4";

  if (collapsible) {
    return (
      <div className={frame}>
        <div
          className="flex items-center justify-between mb-3 cursor-pointer"
          onClick={() => setCollapsed(!collapsed)}
        >
          <h3 className="text-sm font-medium text-emerald-400">
            Diurn entry {collapsed ? "(click to expand)" : ""}
          </h3>
          <span className="text-xs text-zinc-500">{collapsed ? "\u25B6" : "\u25BC"}</span>
        </div>
        {!collapsed && inner}
      </div>
    );
  }

  return (
    <div className={frame}>
      {inner}
    </div>
  );
}