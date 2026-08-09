export function SkeletonBlock({ w = "100%", h = "1rem", rounded = "rounded-lg" }: { w?: string; h?: string; rounded?: string }) {
  return <div className={`animate-pulse bg-zinc-800 ${rounded}`} style={{ width: w, height: h }} />;
}


export function SkeletonPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-4 pb-32 px-0">
      {children}
    </div>
  );
}