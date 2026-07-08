import { useState } from 'react'
import OperationsShell, { PageHeading, SubTabs, ComingSoon } from '../../components/OperationsShell'

const SUB_TABS = [
  { key: 'builder', label: 'RAMS Builder' },
  { key: 'matrix', label: 'RAMS Matrix' },
]

export default function RamsPage() {
  const [sub, setSub] = useState('builder')
  return (
    <OperationsShell active="rams" title="RAMS">
      <PageHeading title="RAMS" sub="Risk Assessments & Method Statements" />
      <SubTabs tabs={SUB_TABS} active={sub} onChange={setSub} />
      {sub === 'builder' && <ComingSoon title="RAMS Builder" note="Auto-generate RAMS from your library of previous RAMS and task data, then edit before issuing. We'll build this once your RAMS library is uploaded." />}
      {sub === 'matrix' && <ComingSoon title="RAMS Matrix" note="Overview of which RAMS exist per project, their version, and sign-off status." />}
    </OperationsShell>
  )
}
