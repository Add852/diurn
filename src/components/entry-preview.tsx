"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { parseFrontmatter } from "@/lib/frontmatter";

export const FM_LABELS: Record<string, string> = {
  dayOfWeek: "Day",
  mood: "Mood",
  energy: "Energy",
  tags: "Tags",
  weather: "Weather",
};

export function fmt(_key: string, value: any): string {
  if (value === true) return "yes";
  if (value === false) return "no";
  return String(value);
}

interface EntryPreviewProps {
  markdown: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export function EntryPreview({ markdown, collapsible, defaultCollapsed }: EntryPreviewProps) {
  const { data, body } = parseFrontmatter(markdown);
  const hasFM = Object.keys(data).length > 0;
  const [collapsed, setCollapsed] = useState(!!defaultCollapsed);

  const inner = (
    <>
      {hasFM && (
        <div className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1.5 bg-zinc-800/50 rounded-lg p-3">
          {Object.entries(data).map(([key, value]) => (
            <div key={key} className="flex justify-between items-center min-w-0">
              <span className="text-xs text-zinc-500 truncate">{FM_LABELS[key] || key}</span>
              <span className="text-xs text-zinc-200 font-medium ml-2">{fmt(key, value)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="prose prose-invert prose-sm max-w-none">
        <ReactMarkdown>{body}</ReactMarkdown>
      </div>
    </>
  );

  if (collapsible) {
    return (
      <div className="bg-zinc-900 border border-emerald-800 rounded-lg p-4 mb-4">
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
    <div className="bg-zinc-900 border border-emerald-800 rounded-lg p-4 mb-4">
      {inner}
    </div>
  );
}