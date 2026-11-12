/**
 * Issues a short-lived (10 min) Azure Speech token so the browser can talk to
 * Azure directly. The subscription key never leaves the server (CLAUDE.md §0.2).
 */
import { env, sameOrigin } from '../lib/guard.mts'

export default async (req: Request): Promise<Response> => {
  // Same-origin only: keeps third-party pages and simple scripts from spending the quota.
  if (!sameOrigin(req)) return Response.json({ error: 'forbidden' }, { status: 403 })

  // AZURE_SPEECH_KEY / AZURE_SPEECH_REGION are the documented names; the others are common spellings.
  const key = env('AZURE_SPEECH_KEY', 'AZURE_KEY', 'SPEECH_KEY')
  const region = env('AZURE_SPEECH_REGION', 'AZURE_REGION', 'SPEECH_REGION')
  // Status only (Settings): says what is missing without issuing a token.
  if (new URL(req.url).searchParams.has('check')) {
    return Response.json({ configured: !!key && !!region, missing: [!key && 'AZURE_SPEECH_KEY', !region && 'AZURE_SPEECH_REGION'].filter(Boolean) }, { headers: { 'Cache-Control': 'no-store' } })
  }
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
