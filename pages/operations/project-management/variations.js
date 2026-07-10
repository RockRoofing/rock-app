import { useState, useEffect } from 'react'
import OperationsShell from '../../../components/OperationsShell'

// Ops Variations = an exact, editable mirror of the Commercial Variation
// Tracker (/variations). We embed the real page (embed=true hides its own nav)
// so both are literally the same page and data — edit in either, both update.
export default function OpsVariations() {
  const [height, setHeight] = useState('calc(100vh - 150px)')
  useEffect(() => {
    const fit = () => setHeight(`calc(100vh - ${Math.max(120, 150)}px)`)
    fit(); window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit)
  }, [])
  return (
    <OperationsShell active="pm:variations" section="pm" title="Variations" wide>
      <iframe
        src="/variations?embed=true"
        style={{ width: '100%', height, border: 'none', display: 'block', borderRadius: 12, background: '#fff' }}
        title="Variations"
      />
    </OperationsShell>
  )
}
