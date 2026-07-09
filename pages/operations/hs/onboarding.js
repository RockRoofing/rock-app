import OperationsShell, { PageHeading, ComingSoon } from '../../../components/OperationsShell'

export default function Onboarding() {
  return (
    <OperationsShell active="hs:onboarding" section="hs" title="Sub-Contractor Onboarding">
      <PageHeading title="Sub-Contractor Onboarding" />
      <ComingSoon title="Sub-Contractor Onboarding" note="Sub-contractor onboarding — coming soon." />
    </OperationsShell>
  )
}
