import { test } from "node:test";
import assert from "node:assert/strict";
import { parseByteRange } from "../src/lib/range.ts";
import { safeReturnTo } from "../src/lib/safe-return.ts";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import { renderTemplate, formatTemplateDate, identifierError } from "../src/lib/template.ts";
import { localDate, dateRange } from "../src/lib/timezone.ts";

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
  const r = dateRange("http://x?date=2026-08-09", "America/New_York");
  assert.equal(r.min, "2026-08-09T00:00:00-04:00");
  assert.equal(r.max, "2026-08-09T23:59:59-04:00");
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