import { useEffect } from 'react'
import { useRouter } from 'next/router'

// Leak Test Cert Builder has been removed. Redirect any old link to Leak Test Certs.
export default function Removed() {
  const router = useRouter()
  useEffect(() => {
    const p = router.query.project ? String(router.query.project) : ''
    if (p) router.replace(`/design/${encodeURIComponent(p)}/leak-test-certs`)
  }, [router.query.project])
  return null
}
