"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

const tabs = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/viewer", label: "Journal", icon: BookIcon },
  { href: "/settings", label: "Settings", icon: CogIcon },
];

function NavLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: typeof HomeIcon; active: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
        active ? "bg-zinc-800 text-emerald-400" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
      }`}
    >
      <Icon active={active} />
      <span className="hidden md:inline">{label}</span>
    </Link>
  );
}

export function NavBar() {
  const path = usePathname();

  if (path === "/login" || path === "/setup") return null;

  return (
    <>
      {/* Desktop sidebar nav */}
      <nav className="hidden md:block fixed left-0 top-0 bottom-0 w-48 bg-zinc-900 border-r border-zinc-800 z-50">
        <div className="px-3 pt-4 pb-2">
          <p className="text-xs text-zinc-500 font-medium px-3 mb-3">Diurn</p>
          <div className="space-y-1">
            {tabs.map((t) => {
              const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
              return <NavLink key={t.href} href={t.href} label={t.label} icon={t.icon} active={active} />;
            })}
          </div>
        </div>
      </nav>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-14 bg-zinc-900 border-t border-zinc-800 z-50">
        <div className="flex max-w-2xl mx-auto safe-bottom">
          {tabs.map((t) => {
            const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`flex-1 flex flex-col items-center py-2 text-xs gap-0.5 transition-colors ${
                  active ? "text-emerald-400" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <t.icon active={active} />
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
    </svg>
  );
}

function BookIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  );
}

function CogIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}