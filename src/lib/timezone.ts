export function localDate(input: number | string | Date, timezone?: string, offsetHours?: number): string {
  const offset = offsetHours != null && Number.isFinite(offsetHours) ? Math.trunc(offsetHours) : 0;
  const raw = input instanceof Date ? input.getTime() : new Date(input).getTime();
  const d = new Date(raw - offset * 3_600_000);
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

export function dateRange(date: string, timezone?: string, offsetHours?: number): { min: string; max: string } {
  const offset = offsetHours != null && Number.isFinite(offsetHours) ? Math.trunc(offsetHours) : 0;
  const target = date || todayUTC();

  if (!timezone || timezone === "UTC") {
    return { min: `${target}T00:00:00Z`, max: `${target}T23:59:59Z` };
  }

  try {
    const tzOffsetMin = getOffsetMinutes(timezone, target);
    const offsetStr = formatOffset(tzOffsetMin);
    return {
      min: isoAtHour(target, offset, offsetStr),
      max: isoAtHour(target, offset + 24, offsetStr),
    };
  } catch {
    return { min: `${target}T00:00:00Z`, max: `${target}T23:59:59Z` };
  }
}

function todayUTC(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
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

function formatOffset(min: number): string {
  const sign = min >= 0 ? "+" : "-";
  const abs = Math.abs(min);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

function isoAtHour(date: string, hour: number, offsetStr: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, hour, 0, 0));
  return `${String(dt.getUTCFullYear()).padStart(4, "0")}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}T${String(dt.getUTCHours()).padStart(2, "0")}:00:00${offsetStr}`;
}
