import { useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { useDesignProjectAuth, DesignNav } from '../../../lib/designShell'
import HandoverDocs from '../../../components/HandoverDocs'

export default function HandoverDocsPage() {
  const router = useRouter()
  const projectNo = router.query.project ? String(router.query.project) : ''
  const auth = useDesignProjectAuth(projectNo)
  // Handover Docs is internal-only - send customers back to the design home.
  useEffect(() => { if (auth.ready && auth.isExternal) router.replace(`/design/${encodeURIComponent(projectNo)}/rfis`) }, [auth.ready, auth.isExternal, projectNo])
  if (!auth.ready) return null
  return (
    <>
      <Head><title>Handover Docs - Design</title></Head>
      <HandoverDocs projectNo={projectNo}
        nav={<DesignNav active="handover-docs" projectNo={projectNo} projectName={auth.project && auth.project.name} isInternal={auth.isInternal} />} />
    </>
  )
}
