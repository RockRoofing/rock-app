import OperationsShell, { PageHeading, ComingSoon } from '../../../components/OperationsShell'

export default function Page() {
  return (
    <OperationsShell active="pm:planning" section="pm" title="Project Planning">
      <PageHeading title="Project Planning" />
      <ComingSoon title="Project Planning" note="Combined Gantt programme view and Weekly Labour Allocation. We'll build this next \u2014 it links the project programme (headcount per project per day) with the per-person weekly allocation." />
    </OperationsShell>
  )
}
