/**
 * Shared request check for the functions. There is no login in this app, so
 * this is not real access control: it only turns away other websites and
 * simple scripts, which is what would otherwise spend the free AI/Azure quota.
 */
export function sameOrigin(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site')
  if (site) return site === 'same-origin'
  // Older Safari sends no Sec-Fetch-Site: fall back to Origin, then Referer.
  const host = req.headers.get('host') ?? new URL(req.url).host
  const from = req.headers.get('origin') ?? req.headers.get('referer')
  if (!from) return false
  try {
    return new URL(from).host === host
  } catch {
    return false
  }
}

/** First non-empty environment variable among the given names. */
export function env(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n]?.trim()
    if (v) return v
  }
  return undefined
}
