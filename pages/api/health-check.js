import { getLastSync } from '../../lib/db'

// This endpoint can be called by a separate cron or monitoring service
// to check if the sync is healthy and send an alert if not
export default async function handler(req, res) {
  const lastSync = await getLastSync()
  const hoursSinceSync = lastSync ? (Date.now() - new Date(lastSync).getTime()) / (1000 * 60 * 60) : null

  const isHealthy = hoursSinceSync !== null && hoursSinceSync < 25

  if (!isHealthy) {
    // Send email alert via Resend (or similar) if configured
    const RESEND_KEY = process.env.RESEND_API_KEY
    const ALERT_EMAIL = process.env.ALERT_EMAIL
    if (RESEND_KEY && ALERT_EMAIL) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Rock Roofing Sales Dashboard <onboarding@resend.dev>',
            to: ALERT_EMAIL,
            subject: '⚠️ Rock Roofing Dashboard — Sync Alert',
            html: `<p>The Pipedrive sync hasn't run in over 25 hours.</p><p>Last sync: ${lastSync || 'never'}</p><p>Please check the dashboard and Vercel logs.</p>`
          })
        })
      } catch (e) {
        console.error('Failed to send alert email:', e.message)
      }
    }
  }

  return res.status(200).json({ healthy: isHealthy, lastSync, hoursSinceSync })
}
