/**
 * Issues a short-lived (10 min) Azure Speech token so the browser can talk to
 * Azure directly. The subscription key never leaves the server (CLAUDE.md §0.2).
 */
export default async (req: Request): Promise<Response> => {
  // Same-origin only: keeps casual third-party pages from spending the quota.
  const site = req.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') return Response.json({ error: 'forbidden' }, { status: 403 })

  const key = process.env.AZURE_SPEECH_KEY
  const region = process.env.AZURE_SPEECH_REGION
  if (!key || !region) return Response.json({ error: 'not-configured' }, { status: 503 })

  const azure = await fetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Length': '0' },
  })
  if (!azure.ok) return Response.json({ error: 'azure', status: azure.status }, { status: 502 })

  return Response.json(
    { token: await azure.text(), region, expiresInSec: 540 },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export const config = { path: '/api/speech-token' }
