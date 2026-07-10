import OperationsShell, { PageHeading, ComingSoon } from '../../../components/OperationsShell'

// RAMS Matrix only. RAMS Builder now lives as its own H&S tab.
export default function RamsMatrixPage() {
  return (
    <OperationsShell active="hs:rams-matrix" section="hs" title="RAMS Matrix">
      <PageHeading title="RAMS Matrix" sub="Overview of which RAMS exist per project, their version, and sign-off status." />
      <ComingSoon title="RAMS Matrix" note="Overview of which RAMS exist per project, their version, and sign-off status." />
    </OperationsShell>
  )
}
