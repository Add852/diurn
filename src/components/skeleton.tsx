export function SkeletonBlock({ w = "100%", h = "1rem", rounded = "rounded-lg" }: { w?: string; h?: string; rounded?: string }) {
  return <div className={`animate-pulse bg-zinc-800 ${rounded}`} style={{ width: w, height: h }} />;
}

export function SkeletonLines() {
  return (
    <div className="mx-auto max-w-md space-y-3 py-8">
      <SkeletonBlock w="100%" h="14px" rounded="rounded" />
      <SkeletonBlock w="85%" h="14px" rounded="rounded" />
      <SkeletonBlock w="60%" h="14px" rounded="rounded" />
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