import CommercialTaskTable from '../components/CommercialTaskTable'
export default function WeeklyTasks() {
  return <CommercialTaskTable cadence="weekly" active="/weekly-tasks"
    title="Weekly Commercial Tasks"
    subtitle="All weekly commercial tasks to be completed by latest Close of Play Thursday." />
}
