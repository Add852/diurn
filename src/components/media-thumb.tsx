export function MediaThumb({ src, iconClass = "w-4 h-4" }: { src: string; iconClass?: string }) {
  return (
    <div className="relative w-full h-full bg-zinc-950">
      <video src={src} muted preload="metadata" className="w-full h-full object-cover" />
      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
        <svg className={`${iconClass} text-white`} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
      </div>
    </div>
  );
}