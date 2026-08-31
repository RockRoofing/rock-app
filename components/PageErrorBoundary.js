import { Component } from 'react'

// SHOWS THE ACTUAL ERROR INSTEAD OF "a client-side exception has occurred".
//
// Next's production build replaces every render error with that one sentence, which
// means a one-line fault - an undefined identifier, a null dereference - costs a full
// round trip to diagnose. There is no reason for the person using the page to be the
// only one who cannot see what went wrong.
//
// A class component on purpose: componentDidCatch has no hook equivalent.
export default class PageErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ error, info })
    // Still logged, so it reaches Vercel's function logs as well as the screen.
    console.error('Page error:', error, info)
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    // The first few frames are the useful part; the rest is React internals.
    const stack = String(info?.componentStack || error?.stack || '')
      .split('\n').filter(Boolean).slice(0, 8).join('\n')

    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ background: '#fff', border: '1px solid #fecaca', borderLeft: '4px solid #dc2626', borderRadius: 10, padding: '16px 18px', maxWidth: 900 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#b91c1c', marginBottom: 6 }}>This page hit an error</div>
          <div style={{ fontSize: 13, color: '#333', marginBottom: 10 }}>
            Nothing has been lost - your data is untouched. The message below says what went wrong.
          </div>
          <pre style={{ background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: 8, padding: 12, fontSize: 12.5, color: '#7f1d1d', whiteSpace: 'pre-wrap', margin: 0 }}>
{String(error?.message || error)}
          </pre>
          {stack && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: '#888' }}>Where it happened</summary>
              <pre style={{ background: '#faf9f7', border: '1px solid #eee', borderRadius: 8, padding: 12, fontSize: 11, color: '#555', whiteSpace: 'pre-wrap', marginTop: 6 }}>{stack}</pre>
            </details>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={() => this.setState({ error: null, info: null })}
              style={{ background: '#1a1a19', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>Try again</button>
            <button onClick={() => window.location.reload()}
              style={{ background: '#f2f2f0', border: '1px solid #e2e2de', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>Reload the page</button>
          </div>
        </div>
      </div>
    )
  }
}
