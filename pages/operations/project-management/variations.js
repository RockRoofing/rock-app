import OperationsShell, { PageHeading, ComingSoon } from '../../../components/OperationsShell'

export default function Variations() {
  return (
    <OperationsShell active="pm:variations" section="pm" title="Variations">
      <PageHeading title="Variations" />
      <ComingSoon title="Variations" note="Project variations — coming soon." />
    </OperationsShell>
  )
}
