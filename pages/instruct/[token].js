import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'

// The page a customer lands on from the "Instruct variation" button.
//
// PUBLIC by design - no portal login. The token in the URL is the authentication, and it
// authorises exactly one thing on one variation.
//
// It shows them what they are instructing before they instruct it. A link that instructed
// on click would be quicker and would also mean a mis-click, a link preview or an email
// scanner could commit us to work - so there is a page, and a button on it.
export default function InstructVariation() {
  const router = useRouter()
  const { token } = router.query
  const [state, setState] = useState({ loading: true })
  const [busy, setBusy] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [role, setRole] = useState('')
  const [company, setCompany] = useState('')

  useEffect(() => {
    if (!token) return
    fetch(`/api/variation-instruct?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => {
        setState({ loading: false, ...d })
        // ONLY WHEN WE HOLD THE PERSON. Prefilling ran whatever d.onFile said, so a form
        // that had just told somebody "we do not hold your details" arrived with the
        // project's company name already in it - contradicting itself, and part-filling a
        // record that is supposed to be theirs.
        //
        // On file: these are shown as fixed text, not as inputs, and the server uses its
        // own copy regardless. Not on file: nothing is suggested at all.
        if (d.onFile && d.contact?.name) {
          // The handover holds one name field, so the last word is the surname. Wrong for
          // a double-barrelled one - but these are display-only when on file, and the
          // server sends the same split, so the two cannot disagree.
          const parts = String(d.contact.name).trim().split(/\s+/)
          setFirstName(parts.slice(0, -1).join(' ') || parts[0] || '')
          setLastName(parts.length > 1 ? parts[parts.length - 1] : '')
          setRole(d.contact.role || '')
          setCompany(d.customerCompany || '')
        }
      })
      .catch(() => setState({ loading: false, error: 'Could not load this variation.' }))
  }, [token])

  async function instruct() {
    setBusy(true)
    try {
      const r = await fetch('/api/variation-instruct', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name: `${firstName} ${lastName}`.trim(), firstName, lastName, role, company }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed')
      setState(s => ({ ...s, instructed: true, instruction: d.instruction }))
    } catch (e) { setState(s => ({ ...s, error: e.message })) }
    setBusy(false)
  }

  // Every field filled before the button will work.
  // On file: nothing to complete, the details are ours. Otherwise all four are required.
  const complete = state.onFile || [firstName, lastName, role, company].every(v => String(v).trim())

  const money = (v) => '£' + (Number(v) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const box = { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', maxWidth: 720, margin: '0 auto' }

  return (
    <>
      <Head><title>Instruct variation · Rock Roofing</title></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#f0f2f5', padding: '6vh 16px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 42 }} />
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a2e' }}>Variation instruction</div>
        </div>

        {state.loading ? (
          <div style={{ ...box, color: '#888' }}>Loading…</div>
        ) : state.error ? (
          <div style={{ ...box, color: '#b91c1c' }}>
            <strong>{state.error}</strong>
            <div style={{ fontSize: 13, color: '#666', marginTop: 8 }}>
              This link may have expired. Please reply to the email it came from and we will send a new one.
            </div>
          </div>
        ) : state.instructed ? (
          <div style={box}>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#15803d' }}>Variation {state.varNumber} instructed</div>
            <div style={{ fontSize: 13.5, color: '#444', marginTop: 8, lineHeight: 1.6 }}>
              Thank you. {state.projectName} &mdash; {state.description || 'variation'} at <strong>{money(state.value)}</strong> has been instructed
              {state.instruction?.byName ? ` by ${[state.instruction.byName, state.instruction.byRole, state.instruction.byCompany].filter(Boolean).join(', ')}` : ''}
              {state.instruction?.at ? ` on ${new Date(state.instruction.at).toLocaleString('en-GB')}` : ''}.
            </div>
            <div style={{ fontSize: 12.5, color: '#888', marginTop: 12 }}>
              This instruction has been recorded and will be attached to the next application for payment.
              No further action is needed.
            </div>
          </div>
        ) : (
          <div style={box}>
            <div style={{ fontSize: 12, color: '#888' }}>{state.projectName}</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: '#1a1a2e', marginTop: 2 }}>
              Variation {state.varNumber}
            </div>
            <div style={{ fontSize: 14, color: '#444', marginTop: 6 }}>{state.description}</div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12, margin: '18px 0', padding: '14px 16px', background: '#f8f9fa', borderRadius: 8 }}>
              {[['Sub-Contract Ref', state.subContractRef], ['Date', state.date], ['Requested by', state.requestedBy], ['Value', money(state.value)]].map(([l, v]) => (
                <div key={l}>
                  <div style={{ fontSize: 10.5, color: '#888' }}>{l}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1a1a2e' }}>{v || '—'}</div>
                </div>
              ))}
            </div>

            <a href={`/api/variation-instruct?token=${encodeURIComponent(token || '')}&pdf=1`} target="_blank" rel="noreferrer"
              style={{ fontSize: 13, color: '#2563eb', fontWeight: 600 }}>
              View the variation document (PDF)
            </a>

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #eee' }}>
              {/* FIXED WHERE WE HOLD THEM. If this person is on the handover, the
                    details are ours and are shown rather than asked for - so nobody can
                    put a customer's name against their own click. Where the address was
                    typed by hand we hold nothing, so everything must be entered. */}
                {state.onFile ? (
                  <div style={{ padding: '12px 14px', background: '#f8f9fa', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Instructing as</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>{firstName} {lastName}</div>
                    <div style={{ fontSize: 13, color: '#555' }}>{[role, company].filter(Boolean).join(', ')}</div>
                    <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>{state.sentTo}</div>
                    <div style={{ fontSize: 11.5, color: '#888', marginTop: 8 }}>
                      Taken from our records for this project. If anything here is wrong, please reply to the email rather than instructing.
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 12.5, color: '#92400e', marginBottom: 8 }}>
                      We do not hold your details for this project, so please enter them.
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10, maxWidth: 640 }}>
                      {/* NO REAL NAMES AS PLACEHOLDERS. "Jack" and "Belshaw" sat greyed in
                          the boxes looking like a suggestion of who to be - on a form
                          whose entire purpose is recording who is instructing, that is
                          the last thing to prompt. */}
                      {[['First name', firstName, setFirstName, 'First name…'],
                        ['Last name', lastName, setLastName, 'Last name…'],
                        ['Your role', role, setRole, 'Your role…'],
                        ['Your company', company, setCompany, 'Your company…']].map(([l, v, set, ph]) => (
                        <div key={l}>
                          <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>{l} *</label>
                          <input value={v} onChange={e => set(e.target.value)} placeholder={ph}
                            style={{ padding: '9px 11px', border: `1px solid ${String(v).trim() ? '#ddd' : '#fca5a5'}`, background: String(v).trim() ? '#fff' : '#fef2f2', borderRadius: 8, fontSize: 14, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                        </div>
                      ))}
                    </div>
                  </>
                )}

              {!complete && !state.onFile && (
                <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 8, fontWeight: 600 }}>
                  Please complete every field before instructing.
                </div>
              )}
              <div style={{ fontSize: 11.5, color: '#888', marginTop: 8 }}>
                {state.contact?.name ? 'Filled in from our records — please correct anything that is wrong. ' : ''}
                Recorded with the instruction, alongside {state.sentTo || 'the email address this link was sent to'}.
              </div>

              <button onClick={instruct} disabled={busy || !complete}
                style={{
                  display: 'block', marginTop: 16,
                  background: (busy || !complete) ? '#e5e7eb' : '#15803d',
                  color: (busy || !complete) ? '#9ca3af' : '#fff',
                  border: 'none', borderRadius: 8, padding: '12px 26px', fontSize: 15, fontWeight: 700,
                  cursor: (busy || !complete) ? 'default' : 'pointer',
                }}>
                {busy ? 'Recording…' : `Instruct variation ${state.varNumber}`}
              </button>
              <div style={{ fontSize: 11.5, color: '#888', marginTop: 8 }}>
                By instructing, you are confirming the works and the value above.
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
