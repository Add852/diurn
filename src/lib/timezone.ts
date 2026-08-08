export function localDate(input: number | string | Date, timezone?: string): string {
  const d = input instanceof Date ? input : new Date(input);
  if (!timezone || timezone === "UTC") {
    return d.toISOString().split("T")[0];
  }
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().split("T")[0];
  }
}

export function dateRange(reqUrl: string, timezone?: string): { min: string; max: string } {
  const date = new URL(reqUrl).searchParams.get("date");
  const target = date || todayUTC();

  if (!timezone || timezone === "UTC") {
    return { min: `${target}T00:00:00Z`, max: `${target}T23:59:59Z` };
  }

  try {
    const offset = getOffsetMinutes(timezone, target);
    const offsetStr = offset >= 0
      ? `+${String(Math.floor(offset / 60)).padStart(2, "0")}:${String(offset % 60).padStart(2, "0")}`
      : `-${String(Math.floor(-offset / 60)).padStart(2, "0")}:${String(-offset % 60).padStart(2, "0")}`;
    return {
      min: `${target}T00:00:00${offsetStr}`,
      max: `${target}T23:59:59${offsetStr}`,
    };
  } catch {
    return { min: `${target}T00:00:00Z`, max: `${target}T23:59:59Z` };
  }
}

function todayUTC(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getOffsetMinutes(tz: string, date: string): number {
  const local = new Date(`${date}T12:00:00`);
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" });
  const tzPart = formatter.formatToParts(local).find((p) => p.type === "timeZoneName")?.value || "UTC";
  const m = tzPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  const mins = parseInt(m[2], 10) * 60 + (parseInt(m[3] || "0", 10));
  return m[1] === "-" ? -mins : mins;
}