import '../styles/globals.css'
import ReportProblemButton from '../components/ReportProblemButton'

export default function App({ Component, pageProps }) {
  return (
    <>
      <Component {...pageProps} />
      <ReportProblemButton />
    </>
  )
}
