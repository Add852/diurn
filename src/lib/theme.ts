// Client-side theme persistence. Theme + accent live in localStorage
// (per-device — a desktop may want dark while a phone wants light).
// The head bootstrap applies them before first paint.
// Color values are space-separated RGB triplets (no rgb()/hash) so they
// plug into Tailwind's <alpha-value> compilation (see tailwind.config.ts).

export type ThemeMode = "system" | "dark" | "light";
export const ACCENTS = ["emerald", "blue", "violet", "rose", "amber"] as const;
export type Accent = (typeof ACCENTS)[number];

export function isValidAccent(v: string | null): v is Accent {
  return !!v && (ACCENTS as readonly string[]).includes(v);
}

function hexToRgbTriplet(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

// Tailwind ramp steps are NOT evenly spaced (…500, 600, 700, 800, 900, 950 —
// no 550). Indexing accent vars by (i+1)*50 produced garbage steps and only
// the first two ever matched, leaving buttons/links on the emerald fallback.
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

// 50 … 950, same step roles as Tailwind's ramps.
const ACCENT_HEX: Record<Accent, string[]> = {
  emerald: ["#d1fae5", "#a7f3d0", "#6ee7b7", "#34d399", "#10b981", "#059669", "#047857", "#065f46", "#064e3b", "#022c22", "#014208"],
  blue: ["#eff6ff", "#dbeafe", "#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af", "#1e3a8a", "#172554"],
  violet: ["#f5f3ff", "#ede9fe", "#ddd6fe", "#c4b5fd", "#a78bfa", "#8b5cf6", "#7c3aed", "#6d28d9", "#5b21b6", "#4c1d95", "#2e1065"],
  rose: ["#fff1f2", "#ffe4e6", "#fecdd3", "#fda4af", "#fb7185", "#f43f5e", "#e11d48", "#be123c", "#9f1239", "#881337", "#4c0519"],
  amber: ["#fffbeb", "#fef3c7", "#fde68a", "#fcd34d", "#fbbf24", "#f59e0b", "#d97706", "#b45309", "#92400e", "#78350f", "#451a03"],
};

export const ACCENT_SWATCH: Record<Accent, string> = {
  emerald: "#059669",
  blue: "#3b82f6",
  violet: "#8b5cf6",
  rose: "#f43f5e",
  amber: "#f59e0b",
};

export function applyTheme(mode: ThemeMode, accent: Accent) {
  const root = document.documentElement;
  const effective = mode === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : mode;
  root.dataset.theme = effective;
  ACCENT_HEX[accent].forEach((hex, i) => root.style.setProperty(`--accent-${STEPS[i]}`, hexToRgbTriplet(hex)));
  root.style.setProperty("color-scheme", effective);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", effective === "dark" ? "#09090b" : "#f7f7f8");
}

export function applyThemeFromStorage() {
  const mode = (localStorage.getItem("diurn-theme") as ThemeMode | null) || "system";
  const accentRaw = localStorage.getItem("diurn-accent");
  const accent = isValidAccent(accentRaw) ? accentRaw : "emerald";
  applyTheme(mode, accent);
}

// Inline <head> script: applies stored theme before first paint — no flash.
// Self-contained duplicate of applyTheme (no imports in inline scripts).
export const THEME_BOOTSTRAP = `(function(){try{var m=localStorage.getItem("diurn-theme")||"system";var a=localStorage.getItem("diurn-accent")||"emerald";var r=document.documentElement;var e=m==="system"?(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):m;r.dataset.theme=e;var H={emerald:["#d1fae5","#a7f3d0","#6ee7b7","#34d399","#10b981","#059669","#047857","#065f46","#064e3b","#022c22","#014208"],blue:["#eff6ff","#dbeafe","#bfdbfe","#93c5fd","#60a5fa","#3b82f6","#2563eb","#1d4ed8","#1e40af","#1e3a8a","#172554"],violet:["#f5f3ff","#ede9fe","#ddd6fe","#c4b5fd","#a78bfa","#8b5cf6","#7c3aed","#6d28d9","#5b21b6","#4c1d95","#2e1065"],rose:["#fff1f2","#ffe4e6","#fecdd3","#fda4af","#fb7185","#f43f5e","#e11d48","#be123c","#9f1239","#881337","#4c0519"],amber:["#fffbeb","#fef3c7","#fde68a","#fcd34d","#fbbf24","#f59e0b","#d97706","#b45309","#92400e","#78350f","#451a03"]};var S=[50,100,200,300,400,500,600,700,800,900,950];var v=H[a]||H.emerald;for(var i=0;i<v.length;i++){var n=parseInt(v[i].slice(1),16);r.style.setProperty("--accent-"+S[i],((n>>16)&255)+" "+((n>>8)&255)+" "+(n&255));}r.style.setProperty("color-scheme",e);var meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.setAttribute("content",e==="dark"?"#09090b":"#f7f7f8");}catch(e){}})();`;

// Sync 'system' mode with OS changes while the app is open.
export function watchSystemTheme() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const cb = () => {
    const mode = (localStorage.getItem("diurn-theme") as ThemeMode | null) || "system";
    if (mode === "system") applyTheme("system", (localStorage.getItem("diurn-accent") as Accent) || "emerald");
  };
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
