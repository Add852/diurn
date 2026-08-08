export function parseFrontmatter(content: string): {
  data: Record<string, any>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content };

  const raw = match[1];
  const body = match[2];
  const data: Record<string, any> = {};

  for (const line of raw.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value: any = line.slice(colon + 1).trim();

    if (!isNaN(Number(value))) value = Number(value);
    else if (value === "true") value = true;
    else if (value === "false") value = false;

    data[key] = value;
  }

  return { data, body };
}