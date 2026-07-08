import OperationsShell, { PageHeading, ComingSoon } from '../../components/OperationsShell'

export default function Page() {
  return (
    <OperationsShell active="tasks" title="Live Project Tasks">
      <PageHeading title="Live Project Tasks" />
      <ComingSoon title="Live Project Tasks" note="Live task tracking moved out of MS Planner \u2014 the day-to-day actions per project." />
    </OperationsShell>
  )
}
