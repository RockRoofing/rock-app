import { useRouter } from 'next/router'
import Head from 'next/head'
import { useDesignProjectAuth, DesignNav, INK, PURPLE } from '../lib/designShell'

export default function DesignSoon({ pageKey, title }) {
  const router = useRouter()
  const projectNo = router.query.project ? String(router.query.project) : ''
  const auth = useDesignProjectAuth(projectNo)
  if (!auth.ready) return null
  return (
    <>
      <Head><title>{title} - Design</title></Head>
      <DesignNav active={pageKey} projectNo={projectNo} projectName={auth.project?.name} isInternal={auth.isInternal} />
      <div style={{ maxWidth: 1600, margin: '0 auto', padding: '22px 28px 60px' }}>
        <h1 style={{ margin: '0 0 6px', color: INK, fontSize: 24 }}>{title}</h1>
        <div style={{ background: '#faf9fd', border: '1px solid #ece9f5', borderRadius: 12, padding: 30, textAlign: 'center', color: '#8a857c', fontSize: 14 }}>
          <div style={{ fontSize: 12, color: PURPLE, fontWeight: 700, letterSpacing: 1 }}>COMING SOON</div>
          <div style={{ marginTop: 8 }}>This page is being built in an upcoming phase.</div>
        </div>
      </div>
    </>
  )
}
