import { SkeletonBlock, SkeletonPage } from "@/components/skeleton";

export default function ViewerLoading() {
  return (
    <SkeletonPage>
      <div className="flex items-center justify-between mb-4 gap-2">
        <SkeletonBlock w="140px" h="28px" rounded="rounded-lg" />
        <SkeletonBlock w="120px" h="24px" rounded="rounded-lg" />
      </div>
      <SkeletonBlock w="100px" h="16px" />
      <div className="mt-3 flex gap-3">
        {[1, 2, 3].map((c) => (
          <div key={c} className="flex-1 flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                <div className="aspect-video bg-zinc-800 animate-pulse" />
                <div className="p-3 space-y-2">
                  <SkeletonBlock w="40%" h="14px" />
                  <SkeletonBlock w="90%" h="11px" rounded="rounded" />
                  <SkeletonBlock w="70%" h="11px" rounded="rounded" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}