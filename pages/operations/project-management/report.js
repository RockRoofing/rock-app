import OperationsShell, { PageHeading, ComingSoon } from '../../../components/OperationsShell'

export default function Page() {
  return (
    <OperationsShell active="pm:report" section="pm" title="Project Report">
      <PageHeading title="Project Report" />
      <ComingSoon title="Project Report" note="The weekly report, assembled from SRATs, forms submissions, variations and procurement. Editable before it goes out." />
    </OperationsShell>
  )
}
