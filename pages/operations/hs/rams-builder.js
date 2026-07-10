import OperationsShell, { PageHeading, ComingSoon } from '../../../components/OperationsShell'

export default function RamsBuilderPage() {
  return (
    <OperationsShell active="hs:rams-builder" section="hs" title="RAMS Builder">
      <PageHeading title="RAMS Builder" sub="Generate branded RAMS from your library and task data, then edit before issuing." />
      <ComingSoon title="RAMS Builder" note="Auto-generate RAMS from your library of previous RAMS and task data, then edit before issuing. We'll build this once your RAMS library is uploaded." />
    </OperationsShell>
  )
}
