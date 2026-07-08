import { useState } from 'react'
import OperationsShell, { PageHeading, SubTabs, ComingSoon } from '../../components/OperationsShell'

const SUB_TABS = [
  { key: 'dori', label: 'Dori' },
  { key: 'mike', label: 'Mike' },
  { key: 'will', label: 'Will' },
  { key: 'forms', label: 'Forms' },
]

export default function OpsScorecardsPage() {
  const [sub, setSub] = useState('dori')
  const current = SUB_TABS.find(t => t.key === sub)
  return (
    <OperationsShell active="scorecards" title="Scorecards">
      <PageHeading title="Operations Scorecards" />
      <SubTabs tabs={SUB_TABS} active={sub} onChange={setSub} />
      <ComingSoon title={`${current.label} scorecard`}
        note={sub === 'forms'
          ? 'Forms completion metrics — submissions vs required, on-time rate, flags raised, per project and per operative.'
          : `${current.label}'s operations KPIs. We'll define the metrics and mirror the Pre-Contract scorecard style.`} />
    </OperationsShell>
  )
}
