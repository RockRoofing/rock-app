import { useEffect } from 'react'
import { useRouter } from 'next/router'

// Moved to /operations/forms. Redirect preserves any ?open=<id> deep link.
export default function SubmissionsRedirect() {
  const router = useRouter()
  useEffect(() => {
    const q = window.location.search || ''
    router.replace('/operations/forms' + q)
  }, [])
  return null
}
