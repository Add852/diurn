/**
 * Validate a `return`/`returnTo` redirect target before it lands in the
 * OAuth state cookie and callback redirect. Only same-origin absolute paths
 * are allowed: no scheme, no `//` (protocol-relative), no backslashes.
 */
export function safeReturnTo(raw: string | null): string {
  if (!raw) return "/settings";
  return /^\/(?!\/|\\).*$/.test(raw) ? raw : "/settings";
}