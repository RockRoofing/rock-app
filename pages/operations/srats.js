import OperationsShell, { PageHeading, ComingSoon } from '../../components/OperationsShell'

export default function Page() {
  return (
    <OperationsShell active="srats" title="SRATs">
      <PageHeading title="SRATs" />
      <ComingSoon title="SRATs" note="Situation, Roadblocks, Actions, Timeline \u2014 weekly per project, carried over week to week. Editable in the portal and completable from the Forms App." />
    </OperationsShell>
  )
}
