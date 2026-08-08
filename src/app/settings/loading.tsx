import { SkeletonBlock, SkeletonPage } from "@/components/skeleton";

export default function SettingsLoading() {
  return (
    <SkeletonPage>
      <div className="flex gap-1.5 flex-wrap mb-6">
        {["General", "AI", "Questions", "Integrations", "Profiles", "Account"].map((t) => (
          <SkeletonBlock key={t} w={`${t.length * 10 + 20}px`} h="28px" rounded="rounded-full" />
        ))}
      </div>

      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i}>
            <SkeletonBlock w="30%" h="12px" />
            <div className="mt-1">
              <SkeletonBlock w="100%" h="36px" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}