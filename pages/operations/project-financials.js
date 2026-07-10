import { useState, useEffect } from 'react'
import OperationsShell from '../../components/OperationsShell'

// Ops Project Financials = exact editable mirror of the Pre-Contract Project
// Financials view. Embeds the same Commercial EOM view (embed=true hides its
// own nav) so both are the same page/data — changes in one show in the other.
export default function OpsProjectFinancials() {
  const [height, setHeight] = useState('calc(100vh - 150px)')
  useEffect(() => {
    const fit = () => setHeight('calc(100vh - 150px)')
    fit(); window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit)
  }, [])
  return (
    <OperationsShell active="financials" section="financials" title="Project Financials" wide>
      <iframe
        src="/commercial?mode=eom&embed=true"
        style={{ width: '100%', height, border: 'none', display: 'block', borderRadius: 12, background: '#fff' }}
        title="Project Financials"
      />
    </OperationsShell>
  )
}
