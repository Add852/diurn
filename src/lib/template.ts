export interface TemplateVar {
  question: string;
  answer: string;
  asked: boolean;
  prompt: string;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

const pad = (n: number) => String(n).padStart(2, "0");

// .NET-style custom date/time format strings (subset): d/M/y/H/h/m/s/t
// tokens, quoted literals ('...'), backslash escapes, D aliased to d.
export function formatTemplateDate(dateStr: string, format: string): string {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return format;
  const y = d.getFullYear();
  const mo = d.getMonth();
  const day = d.getDate();
  const h24 = d.getHours();
  const h12 = h24 % 12 || 12;
  const min = d.getMinutes();
  const sec = d.getSeconds();
  let out = "";
  let i = 0;
  while (i < format.length) {
    const c = format[i];
    if (c === "\\" && i + 1 < format.length) {
      out += format[i + 1];
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = format.indexOf("'", i + 1);
      out += end === -1 ? c : format.slice(i + 1, end);
      i = end === -1 ? i + 1 : end + 1;
      continue;
    }
    let run = 1;
    while (run < 4 && format[i + run] === c) run++;
    switch (c) {
      case "d":
      case "D":
        out += run === 4 ? WEEKDAY_NAMES[d.getDay()] : run === 3 ? WEEKDAY_SHORT[d.getDay()] : run === 2 ? pad(day) : String(day);
        break;
      case "M":
        out += run === 4 ? MONTH_NAMES[mo] : run === 3 ? MONTH_SHORT[mo] : run === 2 ? pad(mo + 1) : String(mo + 1);
        break;
      case "y":
        out += run === 2 ? String(y).slice(-2) : String(y);
        break;
      case "H":
        out += run === 2 ? pad(h24) : String(h24);
        break;
      case "h":
        out += run === 2 ? pad(h12) : String(h12);
        break;
      case "m":
        out += run === 2 ? pad(min) : String(min);
        break;
      case "s":
        out += run === 2 ? pad(sec) : String(sec);
        break;
      case "t":
        out += run >= 2 ? (h24 < 12 ? "AM" : "PM") : h24 < 12 ? "A" : "P";
        break;
      default:
        out += c.repeat(run);
    }
    i += run;
  }
  return out;
}

const RESERVED_IDENTIFIERS = ["question", "answer", "asked", "prompt"];

export function identifierError(identifier: string, existing: string[]): string | null {
  if (!identifier.trim()) return "Variable name is required.";
  if (RESERVED_IDENTIFIERS.includes(identifier)) return `"${identifier}" is reserved by the template syntax.`;
  if (existing.includes(identifier)) return `Variable "${identifier}" already exists.`;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) return "Use only letters, numbers, and underscores.";
  return null;
}

export function renderTemplate(
  template: string,
  vars: Record<string, TemplateVar>,
  dateStr: string
): string {
  // Identifiers are user-editable (settings > questions), so escape them before
  // building the RegExp — an identifier like "Q1." or ".*" must be literal text.
  let result = template;

  result = result.replace(
    /\$date\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g,
    (_m, dq: string | undefined, sq: string | undefined, bare: string | undefined) =>
      formatTemplateDate(dateStr, dq ?? sq ?? bare ?? "")
  );

  for (const [key, value] of Object.entries(vars)) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`\\{${esc}\\.question\\}`, "g"), value.question);
    result = result.replace(new RegExp(`\\{${esc}\\.answer\\}`, "g"), value.answer);
    result = result.replace(new RegExp(`\\{${esc}\\.asked\\}`, "g"), value.asked ? "true" : "false");
    result = result.replace(new RegExp(`\\{${esc}\\.prompt\\}`, "g"), value.prompt);
  }

  return result;
}
