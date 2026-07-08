import OperationsShell, { PageHeading, ComingSoon } from '../../components/OperationsShell'

export default function Page() {
  return (
    <OperationsShell active="training" title="H&S Training Matrix">
      <PageHeading title="H&S Training Matrix" />
      <ComingSoon title="H&S Training Matrix" note="Who holds which tickets and certifications, with expiry tracking and renewal flags." />
    </OperationsShell>
  )
}
