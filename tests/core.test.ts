import { test } from "node:test";
import assert from "node:assert/strict";
import { parseByteRange } from "../src/lib/range.ts";
import { safeReturnTo } from "../src/lib/safe-return.ts";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import { renderTemplate, formatTemplateDate, identifierError } from "../src/lib/template.ts";
import { localDate, dateRange } from "../src/lib/timezone.ts";
import { extractJson } from "../src/lib/ai.ts";

test("parseByteRange: explicit range", () => {
  assert.deepEqual(parseByteRange("bytes=0-99", 1000), { start: 0, end: 99 });
});

test("parseByteRange: open-ended range clamps to EOF", () => {
  assert.deepEqual(parseByteRange("bytes=900-", 1000), { start: 900, end: 999 });
});

test("parseByteRange: over-long end clamps", () => {
  assert.deepEqual(parseByteRange("bytes=0-9999", 1000), { start: 0, end: 999 });
});

test("parseByteRange: suffix range", () => {
  assert.deepEqual(parseByteRange("bytes=-100", 1000), { start: 900, end: 999 });
});

test("parseByteRange: suffix larger than file", () => {
  assert.deepEqual(parseByteRange("bytes=-5000", 1000), { start: 0, end: 999 });
});

test("parseByteRange: unsatisfiable → null", () => {
  assert.equal(parseByteRange("bytes=1000-", 1000), null); // start == size
  assert.equal(parseByteRange("bytes=200-100", 1000), null); // start > end
  assert.equal(parseByteRange("bytes=abc-", 1000), null);
  assert.equal(parseByteRange("bytes=-", 1000), null);
  assert.equal(parseByteRange("items=0-5", 1000), null);
  assert.equal(parseByteRange("bytes=-0", 1000), null);
  assert.equal(parseByteRange("bytes=-abc", 1000), null);
});

test("safeReturnTo: valid paths pass through", () => {
  assert.equal(safeReturnTo("/settings"), "/settings");
  assert.equal(safeReturnTo("/"), "/");
});

test("safeReturnTo: open-redirect payloads fall back", () => {
  assert.equal(safeReturnTo("//evil.com"), "/settings");
  assert.equal(safeReturnTo("/\\evil.com"), "/settings");
  assert.equal(safeReturnTo("https://evil.com"), "/settings");
  assert.equal(safeReturnTo(""), "/settings");
  assert.equal(safeReturnTo(null), "/settings");
  assert.equal(safeReturnTo("/a/../../../etc"), "/a/../../../etc"); // path-traversal is harmless post-redirect
});

test("parseFrontmatter: typed values and body", () => {
  const { data, body } = parseFrontmatter("---\nrating: 4\nmood: good\ncount: 3\n---\nDay text");
  assert.equal(data.rating, 4);
  assert.equal(data.mood, "good");
  assert.equal(data.count, 3);
  assert.equal(body, "Day text");
});

test("parseFrontmatter: missing frontmatter", () => {
  const { data, body } = parseFrontmatter("just a note");
  assert.deepEqual(data, {});
  assert.equal(body, "just a note");
});

test("renderTemplate: $date and answer substitution", () => {
  const out = renderTemplate(
    'X $date("yyyy-MM-dd") {Q1.question} {Q1.answer}',
    { Q1: { question: "Happened?", answer: "Stuff", asked: true, prompt: "p" } },
    "2026-08-09"
  );
  assert.equal(out, "X 2026-08-09 Happened? Stuff");
});

test("localDate: timezone-correct date boundary", () => {
  // 2026-07-01T00:30:00Z is still June 30 in New York (EDT, UTC-4)
  const ms = Date.UTC(2026, 6, 1, 0, 30, 0);
  assert.equal(localDate(ms, "America/New_York"), "2026-06-30");
  assert.equal(localDate(ms, "UTC"), "2026-07-01");
});

test("dateRange: offset formatting", () => {
  const r = dateRange("2026-08-09", "America/New_York");
  assert.equal(r.min, "2026-08-09T00:00:00-04:00");
  assert.equal(r.max, "2026-08-10T00:00:00-04:00");
});

test("dateRange: day offset shifts the window", () => {
  // offset 4 means "day starts at 04:00 in the user's tz"
  const r = dateRange("2026-08-09", "America/New_York", 4);
  assert.equal(r.min, "2026-08-09T04:00:00-04:00");
  assert.equal(r.max, "2026-08-10T04:00:00-04:00");
});

test("dateRange: zero offset matches default behavior", () => {
  const r = dateRange("2026-08-09", "America/New_York", 0);
  assert.equal(r.min, "2026-08-09T00:00:00-04:00");
  assert.equal(r.max, "2026-08-10T00:00:00-04:00");
});

test("localDate: day offset shifts early-morning timestamps to prior day", () => {
  // 2026-08-09T02:00 UTC = 22:00 prev day in NY (EDT, -4)
  // With offset 0, that's still 2026-08-08 in NY
  // With offset 12 (day starts at noon), 2am UTC is 14:00 prev day in NY → still 2026-08-08
  // More useful: 2026-08-09T08:00 UTC = 04:00 in NY → with offset 4, day just started, still 2026-08-09
  // 2026-08-09T06:00 UTC = 02:00 in NY → with offset 4, before day start, still 2026-08-08
  const msEarly = Date.UTC(2026, 7, 9, 6, 0, 0); // 02:00 NY
  const msLate = Date.UTC(2026, 7, 9, 8, 0, 0); // 04:00 NY
  assert.equal(localDate(msEarly, "America/New_York", 0), "2026-08-09");
  assert.equal(localDate(msEarly, "America/New_York", 4), "2026-08-08");
  assert.equal(localDate(msLate, "America/New_York", 4), "2026-08-09");
});

test("formatTemplateDate: .NET specifiers", () => {
  assert.equal(formatTemplateDate("2026-08-10", "dddd"), "Monday");
  assert.equal(formatTemplateDate("2026-08-10", "yyyy-MM-dd"), "2026-08-10");
  assert.equal(formatTemplateDate("2026-08-10", "yyyy-MM-DD"), "2026-08-10"); // D aliased to d
  assert.equal(formatTemplateDate("2026-08-10", "MMMM d, yyyy"), "August 10, 2026");
  assert.equal(formatTemplateDate("2026-08-10", "ddd MMM"), "Mon Aug");
  assert.equal(formatTemplateDate("2026-08-10", "yy"), "26");
  assert.equal(formatTemplateDate("2026-08-10", "HH:mm"), "00:00");
  assert.equal(formatTemplateDate("2026-08-10", "'day' dd"), "day 10");
  assert.equal(formatTemplateDate("2026-08-10", "\\d\\d"), "dd");
  assert.equal(formatTemplateDate("2026-08-10", "Q"), "Q"); // unknown chars pass through
});

test("renderTemplate: $date and full variable fields", () => {
  const tpl = '$date("dddd") | $date("yyyy-MM-dd") | {Q1.question}: {Q1.answer} asked={Q1.asked} prompt={Q1.prompt}';
  const out = renderTemplate(
    tpl,
    { Q1: { question: "Happened?", answer: "Stuff", asked: true, prompt: "short" } },
    "2026-08-10"
  );
  assert.equal(out, "Monday | 2026-08-10 | Happened?: Stuff asked=true prompt=short");
});

test("identifierError: rejects reserved, duplicates, invalid names", () => {
  assert.equal(identifierError("date", []), null);
  assert.equal(identifierError("day_of_week", []), null);
  assert.equal(identifierError("answer", []), '"answer" is reserved by the template syntax.');
  assert.equal(identifierError("Q1", ["Q1"]), 'Variable "Q1" already exists.');
  assert.equal(identifierError("Q 1", []), "Use only letters, numbers, and underscores.");
  assert.equal(identifierError("", []), "Variable name is required.");
  assert.equal(identifierError("Q2", ["Q1"]), null);
});

test("extractJson: bare, prose-wrapped, nested, and garbage LLM replies", () => {
  assert.deepEqual(extractJson('{"covered": true, "missing": []}'), { covered: true, missing: [] });
  assert.deepEqual(extractJson('Sure! Here is the result:\n{"covered": false, "missing": ["Q2"]} as requested.'), { covered: false, missing: ["Q2"] });
  assert.deepEqual(extractJson('{"a": {"b": 1}}'), { a: { b: 1 } });
  assert.equal(extractJson("no json here at all"), null);
  assert.equal(extractJson("{broken"), null);
  assert.equal(extractJson(""), null);
});
// Profile import/export: exported profile (minus identity cols) must contain
// every settings column the import path whitelists, so round-trips are lossless.
test("profile export/import: settings columns round-trip", async () => {
  const Database = (await import("better-sqlite3")).default;
  const { promises: fs } = await import("fs");
  const db = new Database(":memory:");
  db.exec(await fs.readFile(new URL("../src/db/schema.sql", import.meta.url), "utf-8"));
  db.prepare("INSERT INTO users (username, password_hash, salt) VALUES ('u','h','s')").run();
  db.prepare("INSERT INTO profiles (user_id, name) VALUES (1, 'X')").run();
  const profile = db.prepare("SELECT * FROM profiles LIMIT 1").get() as Record<string, unknown>;
  const { id, user_id, is_default, is_active, created_at, ...exported } = profile;
  // name + the 20 settings columns the import whitelist expects
  const expected = ["name", "daily_note_folder", "template_note_path",
    "google_tasks_enabled", "google_tasks_config", "google_calendar_enabled", "google_calendar_config",
    "google_client_id", "google_client_secret", "day_offset_hours",
    "media_enabled", "media_folder",
    "obsidian_enabled", "obsidian_folder", "obsidian_exclude_folders", "obsidian_include_content",
    "llm_endpoint", "llm_model", "llm_api_key", "personality_prompt", "asking_method", "timezone"];
  assert.deepEqual(Object.keys(exported).sort(), expected.sort());
});
