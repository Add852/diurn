import { test } from "node:test";
import assert from "node:assert/strict";
import { parseByteRange } from "../src/lib/range.ts";
import { safeReturnTo } from "../src/lib/safe-return.ts";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import { renderTemplate } from "../src/lib/template.ts";
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

test("renderTemplate: meta and answer substitution", () => {
  const out = renderTemplate(
    "X {date} {Q1.question} {Q1.answer}",
    { Q1: { question: "Happened?", answer: "Stuff" } },
    { date: "2026-08-09", day_of_week: "Sunday", day_number: "1" }
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