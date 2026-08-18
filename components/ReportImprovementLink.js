// The ONE "Report app improvement" link used everywhere in the portal.
//
// This exists so the link cannot drift out of step again. It previously had its styles
// copied into eight separate files, which is exactly why they ended up looking different
// from each other. Change it here and it changes everywhere.
//
// Gold, warning icon, plain text (not a button), sized to sit in a nav bar.
//
// It was 17px, which is larger than every nav item beside it - the CRM was already
// overriding it back down to 13, which is the clue that the shared size was wrong rather
// than that one page was special. 13 matches the nav links themselves.
//
// The Site App has its own version in pages/forms/index.js and is deliberately DIFFERENT
// (orange, underlined, sized for a phone) - do not fold that one in here.

export const reportLinkStyle = {
  color: '#ca8a04',
  fontSize: 13,
  fontFamily: 'inherit',
  background: 'none',
  border: 'none',
  padding: '4px 10px',
  borderRadius: 6,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
}

export default function ReportImprovementLink({ style }) {
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent('open-report-problem'))}
      style={{ ...reportLinkStyle, ...(style || {}) }}>
      <span>&#9888;</span> Report app improvement
    </button>
  )
}
