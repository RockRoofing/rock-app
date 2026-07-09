import OperationsShell, { PageHeading, ComingSoon } from '../../../components/OperationsShell'

export default function Procurement() {
  return (
    <OperationsShell active="pm:procurement" section="pm" title="Procurement">
      <PageHeading title="Procurement" />
      <ComingSoon title="Procurement" note="Procurement tracking — coming soon." />
    </OperationsShell>
  )
}
