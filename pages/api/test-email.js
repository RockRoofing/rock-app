export default async function handler(req, res) {
  const RESEND_KEY = process.env.RESEND_API_KEY
  const ALERT_EMAIL = process.env.ALERT_EMAIL

  if (!RESEND_KEY || !ALERT_EMAIL) {
    return res.status(400).json({ error: 'Missing RESEND_API_KEY or ALERT_EMAIL env vars' })
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Rock Roofing Sales Dashboard <onboarding@resend.dev>',
        to: ALERT_EMAIL,
        subject: '✅ Test alert — Rock Roofing Dashboard',
        html: '<p>This is a test email to confirm the alert system is working correctly.</p>'
      })
    })

    const data = await response.json()
    return res.status(200).json({ sent: response.ok, response: data })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
