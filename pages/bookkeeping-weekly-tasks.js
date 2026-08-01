import TaskGrid from '../components/TaskGrid'
import BookkeepingNav from '../components/BookkeepingNav'

const WEEKLY = [
  { id: 'bw1', text: 'Ensure the email inbox is cleared and up to date by the end of each week.' },
  { id: 'bw2', text: 'Post all subcontractor invoices received during the week.' },
  { id: 'bw3', text: 'Prepare and process payments for all weekly subcontractors by Friday.' },
  { id: 'bw4', text: 'Post weekly payroll journals in Xero.' },
  { id: 'bw5', text: 'Review and resolve any bank reconciliation exceptions or unreconciled transactions.' },
  { id: 'bw6', text: 'Follow up on outstanding bookkeeping queries to avoid delays in month-end processing.' },
]

export default function BookkeepingWeeklyTasks() {
  return <TaskGrid cadence="weekly" tasks={WEEKLY} apiPath="/api/bookkeeping-tasks"
    title="Weekly Bookkeeping Tasks"
    subtitle="All weekly bookkeeping tasks to be completed by the end of each week."
    nav={<BookkeepingNav active="/bookkeeping-weekly-tasks" />} />
}
