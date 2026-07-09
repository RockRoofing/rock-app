import OperationsShell, { PageHeading, ComingSoon } from '../../../components/OperationsShell'

export default function Operatives() {
  return (
    <OperationsShell active="hs:operatives" section="hs" title="Operatives">
      <PageHeading title="Operatives" />
      <ComingSoon title="Operatives" note="Operatives H&S records — coming soon." />
    </OperationsShell>
  )
}
