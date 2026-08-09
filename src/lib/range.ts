export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parse an HTTP Range header (single `bytes=` range only).
 * Returns `null` when the range is malformed or unsatisfiable — caller
 * responds 416 with a `Content-Range` header naming the file size.
 * Suffix ranges (`bytes=-N`) are supported; `end` is clamped to fileSize - 1.
 */
export function parseByteRange(header: string, fileSize: number): ByteRange | null {
  if (fileSize < 0 || Number.isNaN(fileSize)) return null;
  const m = header.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  const s = m[1];
  const e = m[2];

  if (s === "" && e === "") return null;
  if (s === "") {
    const n = parseInt(e, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    const start = Math.max(fileSize - n, 0);
    return { start, end: fileSize - 1 };
  }

  const start = parseInt(s, 10);
  let end = e === "" ? fileSize - 1 : parseInt(e, 10);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start >= fileSize || start < 0) return null;
  if (end > fileSize - 1) end = fileSize - 1;
  if (start > end) return null;
  return { start, end };
}