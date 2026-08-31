import '../styles/globals.css'
import ReportProblemButton from '../components/ReportProblemButton'
import PageErrorBoundary from '../components/PageErrorBoundary'

export default function App({ Component, pageProps }) {
  return (
    <>
      {/* Every page, not just the one that happens to be failing today. A production
          build replaces render errors with "a client-side exception has occurred", which
          tells nobody anything - the boundary shows the real message instead.
          ReportProblemButton stays OUTSIDE it so it still works on a broken page. */}
      <PageErrorBoundary>
        <Component {...pageProps} />
      </PageErrorBoundary>
      <ReportProblemButton />
    </>
  )
}
