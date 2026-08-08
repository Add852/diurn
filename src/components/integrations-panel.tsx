"use client";

export function IntegrationsPanel({ integrations }: { integrations: Record<string, any> }) {
  const hasContent =
    (integrations.media?.files?.length > 0) ||
    (integrations.tasks?.connected && integrations.tasks?.tasks?.length > 0) ||
    (integrations.calendar?.connected && integrations.calendar?.events?.length > 0);

  const anyConnected =
    (integrations.media?.files !== undefined) ||
    integrations.tasks?.connected ||
    integrations.calendar?.connected;

  if (!anyConnected) return null;

  const taskCount = integrations.tasks?.tasks?.length ?? 0;
  const eventCount = integrations.calendar?.events?.length ?? 0;
  const mediaCount = integrations.media?.files?.length ?? 0;
  const total = mediaCount + taskCount + eventCount;

  return (
    <div className="mb-4 bg-zinc-900 border border-zinc-800 rounded-lg p-3">
      <details>
        <summary className="text-xs text-zinc-500 cursor-pointer flex items-center gap-2 list-none">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          Today&rsquo;s integrations
          <span className="text-[10px] text-zinc-600">({total})</span>
        </summary>

        {!hasContent && (
          <p className="mt-2 text-xs text-zinc-600">No context available for today.</p>
        )}

        {hasContent && (
        <div className="mt-2 space-y-3">
          {integrations.media?.files !== undefined && integrations.media.files.length > 0 && (
            <div>
              <p className="text-xs text-zinc-500 mb-1">Media &middot; {integrations.media.files.length} files</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {integrations.media.files.map((m: any) => (
                  <a key={m.path} href={m.src} target="_blank" rel="noreferrer" className="flex-shrink-0 w-14 h-14 bg-zinc-800 rounded-lg border border-zinc-700 overflow-hidden hover:border-zinc-500 transition-colors">
                    {m.type === "image" ? (
                      <img src={m.src} alt={m.name} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full relative bg-zinc-900">
                        <video src={m.src} muted preload="auto" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                      </div>
                    )}
                  </a>
                ))}
              </div>
            </div>
          )}
          {integrations.media?.files !== undefined && integrations.media.files?.length === 0 && (
            <p className="text-xs text-zinc-600">No media taken today.</p>
          )}

          {integrations.tasks?.connected && integrations.tasks?.tasks?.length > 0 && (
            <div>
              <p className="text-xs text-zinc-500 mb-1">{integrations.tasks.tasks.length} task/s completed</p>
              <div className="space-y-0.5">
                {integrations.tasks.tasks.slice(0, 5).map((t: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.status === "completed" ? "bg-emerald-500" : "bg-yellow-500"}`} />
                    <span className="text-zinc-300 truncate">{t.title}</span>
                    <span className="text-zinc-600 ml-auto flex-shrink-0">{t.listName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {integrations.tasks?.connected && integrations.tasks?.tasks?.length === 0 && (
            <p className="text-xs text-zinc-600">No tasks completed today.</p>
          )}

          {integrations.calendar?.connected && integrations.calendar?.events?.length > 0 && (
            <div>
              <p className="text-xs text-zinc-500 mb-1">Calendar &middot; {integrations.calendar.events.length} events</p>
              <div className="space-y-0.5">
                {integrations.calendar.events.slice(0, 5).map((e: any, i: number) => (
                  <div key={i} className="text-xs text-zinc-300 truncate">
                    {e.start?.slice(11, 16) && <span className="text-zinc-600 mr-1">{e.start.slice(11, 16)}</span>}
                    {e.summary}
                  </div>
                ))}
              </div>
            </div>
          )}
          {integrations.calendar?.connected && integrations.calendar?.events?.length === 0 && (
            <p className="text-xs text-zinc-600">No events for today.</p>
          )}

          {integrations.tasks?.connected === false && integrations.tasks?.reason === "not_authenticated" && (
            <p className="text-xs text-zinc-600">Google Tasks not connected &mdash; set up in <a href="/settings" className="text-zinc-400 underline">Settings</a></p>
          )}
          {integrations.calendar?.connected === false && integrations.calendar?.reason === "not_authenticated" && (
            <p className="text-xs text-zinc-600">Google Calendar not connected &mdash; set up in <a href="/settings" className="text-zinc-400 underline">Settings</a></p>
          )}
        </div>
        )}
      </details>
    </div>
  );
}
