import CommercialTaskTable from '../components/CommercialTaskTable'
export default function MonthlyTasks() {
  return <CommercialTaskTable cadence="monthly" active="/monthly-tasks"
    title="Monthly Commercial Tasks"
    subtitle="All Monthly Commercial Tasks to be completed no later than the 15th of every month." />
}
