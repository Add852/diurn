import { SkeletonBlock, SkeletonPage } from "@/components/skeleton";

export default function ChatLoading() {
  return (
    <SkeletonPage>
      <div className="flex flex-col h-[calc(100dvh-3.5rem)] md:h-auto">
        <div className="mb-4 flex items-center justify-between">
          <SkeletonBlock w="120px" h="22px" />
          <SkeletonBlock w="56px" h="22px" rounded="rounded-full" />
        </div>

        <div className="mb-4 bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <SkeletonBlock w="140px" h="14px" />
          <div className="mt-2 space-y-3">
            <SkeletonBlock w="60%" h="11px" rounded="rounded" />
            <div className="flex gap-2">
              {[1, 2, 3].map((i) => <SkeletonBlock key={i} w="56px" h="56px" />)}
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-4 mb-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={`flex ${i % 2 === 0 ? "justify-start mr-8" : "justify-end ml-8"}`}>
              <SkeletonBlock w={i % 2 === 0 ? "70%" : "50%"} h={`${44 + (i % 3) * 12}px`} />
            </div>
          ))}
        </div>

        <div className="sticky bottom-0 bg-zinc-950/95 backdrop-blur pt-2 pb-4 border-t border-zinc-800 z-10">
          <SkeletonBlock w="100%" h="40px" />
        </div>
      </div>
    </SkeletonPage>
  );
}