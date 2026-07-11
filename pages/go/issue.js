import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'

// Smart redirect from the issue-notification email.
//  Desktop/laptop -> portal Issues tracker, opening this issue.
//  Mobile/tablet  -> Site App Issues Log (CM-only), opening this issue.
export default function IssueRedirect() {
  const router = useRouter()
  const [msg, setMsg] = useState('Opening…')

  useEffect(() => {
    if (!router.isReady) return
    const id = router.query.id || ''
    const isMobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent || '')
    try {
      if (isMobile) {
        setMsg('Opening the Site App…')
        window.location.replace(`https://siteapp.rockroofing.co.uk/forms/issues-log?issue=${encodeURIComponent(id)}`)
      } else {
        setMsg('Opening the portal…')
        router.replace(`/operations/project-management/issues?issue=${encodeURIComponent(id)}`)
      }
    } catch {
      router.replace(`/operations/project-management/issues?issue=${encodeURIComponent(id)}`)
    }
  }, [router.isReady])

  return (
    <div style={{ fontFamily: 'system-ui,sans-serif', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafaf9', color: '#666' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>⚠️</div>
        <div>{msg}</div>
        <div style={{ fontSize: 13, marginTop: 12 }}>
          If nothing happens, <a href={`/operations/project-management/issues?issue=${encodeURIComponent(router.query.id || '')}`} style={{ color: '#ca8a04' }}>open on desktop</a>
          {' '}or <a href="https://siteapp.rockroofing.co.uk/forms/issues-log" style={{ color: '#ca8a04' }}>open the Site App</a>.
        </div>
      </div>
    </div>
  )
}
