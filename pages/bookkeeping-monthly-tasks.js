import TaskGrid from '../components/TaskGrid'
import BookkeepingNav from '../components/BookkeepingNav'

const MONTHLY = [
  { id: 'bm1', text: 'Reconcile supplier statements with supplier ledger balances.' },
  { id: 'bm2', text: 'Post all required prepayment journals.' },
  { id: 'bm3', text: 'Post inventory journals and reconcile inventory balances where applicable.' },
  { id: 'bm4', text: 'Complete bank balance reconciliations for all bank accounts.' },
  { id: 'bm13', text: 'Notify the Commercial Team that the WIP can now be completed.' },
  { id: 'bm5', text: 'Obtain the WIP schedule from Nathan and post the required WIP journals.' },
  { id: 'bm6', text: "Update all Apps by uploading the month's invoices and ensuring they are processed correctly." },
  { id: 'bm7', text: 'Review and reconcile retention balances with the relevant Apps/contracts.' },
  { id: 'bm8', text: 'Share the payroll timesheet with Cotton after the 21st of each month.' },
  { id: 'bm9', text: 'Create the payroll payment batch by the 28th of each month.' },
  { id: 'bm10', text: 'Ensure all Cost of Sales (COS) transactions have the correct tracking categories assigned.' },
  { id: 'bm11', text: 'Ensure all month-end journals have been posted before closing the period.' },
  { id: 'bm12', text: 'Confirm that all bookkeeping for the month is complete and ready for VAT preparation, and request Cotton to file VAT for the month.' },
]

export default function BookkeepingMonthlyTasks() {
  return <TaskGrid cadence="monthly" tasks={MONTHLY} apiPath="/api/bookkeeping-tasks"
    startDate={new Date(2026, 7, 15)}
    title="Monthly Bookkeeping Tasks"
    subtitle="All monthly bookkeeping tasks to be completed no later than the 15th of each month."
    nav={<BookkeepingNav active="/bookkeeping-monthly-tasks" />} />
}
