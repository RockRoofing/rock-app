import { useEffect } from 'react'
import { useRouter } from 'next/router'
// Team Members merged into Admin → Portal Users.
export default function TeamRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/admin') }, [])
  return null
}
