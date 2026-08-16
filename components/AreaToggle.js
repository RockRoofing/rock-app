// CRM / Pre-Contract area toggle.
//
// Replaces the "<- Pre-Contract" back button that used to sit in the CRM. Those are two
// halves of one job rather than a parent and child, so a toggle says what a back arrow
// could not: you are in one of two places, and the other is one click away.
//
// Shared deliberately, so the CRM and the Pre-Contract pages cannot end up with two
// slightly different versions of the same control.
//
// Green when on, and a size up from the Pipeline/List toggle beside it - this switches
// area, that switches view, and they should not look like the same weight of decision.

const ON = '#1c704f'

const base = {
  fontSize: 14,
  fontWeight: 700,
  padding: '5px 14px',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  lineHeight: 1.35,
  display: 'inline-block',
}

// active: 'crm' | 'pre-contract'
export default function AreaToggle({ active, style }) {
  const isCrm = active === 'crm'
  return (
    <div style={{
      display: 'inline-flex',
      borderRadius: 8,
      overflow: 'hidden',
      border: '1px solid #3a3a38',
      marginRight: 10,
      flexShrink: 0,
      ...style,
    }}>
      <a href="/crm"
        aria-current={isCrm ? 'page' : undefined}
        style={{ ...base, background: isCrm ? ON : 'transparent', color: isCrm ? '#fff' : '#9a9a97' }}>
        CRM
      </a>
      <a href="/sales-crm"
        aria-current={!isCrm ? 'page' : undefined}
        style={{ ...base, background: !isCrm ? ON : 'transparent', color: !isCrm ? '#fff' : '#9a9a97' }}>
        Pre-Contract
      </a>
    </div>
  )
}
