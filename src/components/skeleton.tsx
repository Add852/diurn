export function SkeletonBlock({ w = "100%", h = "1rem", rounded = "rounded-lg" }: { w?: string; h?: string; rounded?: string }) {
  return <div className={`animate-pulse bg-zinc-800 ${rounded}`} style={{ width: w, height: h }} />;
}

export function SkeletonRow({ cols = 1 }: { cols?: number }) {
  return (
    <div className="flex gap-3">
      {Array.from({ length: cols }).map((_, i) => (
        <SkeletonBlock key={i} w={`${100 / cols}%`} h="14px" />
      ))}
    </div>
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
      <SkeletonBlock w="60%" h="16px" />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock key={i} w={`${85 - i * 10}%`} h="10px" rounded="rounded" />
      ))}
    </div>
  );
}

export function SkeletonPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-4 pb-32 px-0">
      {children}
    </div>
  );
}