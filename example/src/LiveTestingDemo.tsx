/**
 * LiveTestingDemo — Real bank login testing via the Conduit Live Server.
 *
 * When the local server (server/) is running on localhost:3001, this component
 * enables real credential-based bank login testing with:
 *   - Live screenshot preview of the browser session
 *   - SSE event stream with real-time status captions
 *   - MFA code submission
 *
 * When the server is not running, it shows setup instructions.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'

const SERVER_URL = 'http://localhost:3001'

// ─── Types ──────────────────────────────────────────────────────────

interface BankInfo {
  bankId: string
  name: string
  loginUrl: string
}

type SessionStatus =
  | 'idle'
  | 'connecting'
  | 'navigating'
  | 'login_page'
  | 'submitting'
  | 'mfa_required'
  | 'success'
  | 'failed'
  | 'cancelled'

interface SessionState {
  sessionId: string | null
  status: SessionStatus
  caption: string
  events: Array<{ type: string; timestamp: number; [key: string]: unknown }>
  error: string | null
}

// ─── Component ──────────────────────────────────────────────────────

export function LiveTestingDemo() {
  const [serverOnline, setServerOnline] = useState<boolean | null>(null)
  const [banks, setBanks] = useState<BankInfo[]>([])
  const [selectedBank, setSelectedBank] = useState<string>('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [session, setSession] = useState<SessionState>({
    sessionId: null,
    status: 'idle',
    caption: '',
    events: [],
    error: null,
  })
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const screenshotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Check server health ──
  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const res = await fetch(`${SERVER_URL}/api/health`, { signal: AbortSignal.timeout(2000) })
        if (!cancelled && res.ok) {
          await res.json()
          setServerOnline(true)
          // Fetch banks
          const banksRes = await fetch(`${SERVER_URL}/api/banks`)
          const banksData = await banksRes.json()
          setBanks(banksData.banks || [])
          if (banksData.banks?.length > 0 && !selectedBank) {
            setSelectedBank(banksData.banks[0].bankId)
          }
        }
      } catch {
        if (!cancelled) setServerOnline(false)
      }
    }
    check()
    const interval = setInterval(check, 5000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  // ── Screenshot polling ──
  useEffect(() => {
    if (session.sessionId && !['idle', 'success', 'failed', 'cancelled'].includes(session.status)) {
      screenshotIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${SERVER_URL}/api/sessions/${session.sessionId}/screenshot`)
          if (res.ok) {
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            setScreenshotUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url })
          }
        } catch {
          // ignore
        }
      }, 1000)
    }
    return () => {
      if (screenshotIntervalRef.current) clearInterval(screenshotIntervalRef.current)
    }
  }, [session.sessionId, session.status])

  // ── Start session ──
  const startSession = useCallback(async () => {
    if (!selectedBank || !username || !password) return

    setSession({ sessionId: null, status: 'connecting', caption: 'Starting session...', events: [], error: null })
    setScreenshotUrl(null)

    try {
      const res = await fetch(`${SERVER_URL}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankId: selectedBank, username, password }),
      })

      if (!res.ok) {
        const err = await res.json()
        setSession(s => ({ ...s, status: 'failed', error: err.error || 'Failed to start session' }))
        return
      }

      const data = await res.json()
      setSession(s => ({ ...s, sessionId: data.sessionId, status: 'navigating', caption: 'Session started' }))

      // Connect SSE
      const evtSource = new EventSource(`${SERVER_URL}/api/sessions/${data.sessionId}/events`)
      eventSourceRef.current = evtSource

      evtSource.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data)
          setSession(s => {
            const newEvents = [...s.events, event]
            const updates: Partial<SessionState> = { events: newEvents }

            if (event.type === 'caption') {
              updates.caption = event.caption
            }
            if (event.type === 'status') {
              updates.status = event.status
            }
            if (event.type === 'mfa_required') {
              updates.status = 'mfa_required'
              updates.caption = 'MFA required — enter your verification code'
            }
            if (event.type === 'error') {
              updates.status = 'failed'
              updates.error = event.error
              updates.caption = event.error
            }
            if (event.type === 'complete') {
              updates.status = event.status
              evtSource.close()
            }

            return { ...s, ...updates }
          })
        } catch {
          // ignore parse errors
        }
      }

      evtSource.onerror = () => {
        // Reconnect is automatic with EventSource
      }
    } catch (err) {
      setSession(s => ({
        ...s,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Connection failed',
      }))
    }
  }, [selectedBank, username, password])

  // ── Submit MFA ──
  const submitMfa = useCallback(async () => {
    if (!session.sessionId || !mfaCode) return

    try {
      await fetch(`${SERVER_URL}/api/sessions/${session.sessionId}/mfa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: mfaCode }),
      })
      setMfaCode('')
    } catch {
      // ignore
    }
  }, [session.sessionId, mfaCode])

  // ── Cancel session ──
  const cancelSession = useCallback(async () => {
    if (!session.sessionId) return
    try {
      await fetch(`${SERVER_URL}/api/sessions/${session.sessionId}/cancel`, { method: 'POST' })
    } catch {
      // ignore
    }
    if (eventSourceRef.current) eventSourceRef.current.close()
    setSession(s => ({ ...s, status: 'cancelled', caption: 'Session cancelled' }))
  }, [session.sessionId])

  // ── Reset ──
  const reset = useCallback(() => {
    if (eventSourceRef.current) eventSourceRef.current.close()
    if (screenshotIntervalRef.current) clearInterval(screenshotIntervalRef.current)
    setSession({ sessionId: null, status: 'idle', caption: '', events: [], error: null })
    setScreenshotUrl(null)
    setMfaCode('')
  }, [])

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close()
      if (screenshotIntervalRef.current) clearInterval(screenshotIntervalRef.current)
    }
  }, [])

  const isActive = !['idle', 'success', 'failed', 'cancelled'].includes(session.status)

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <section style={sty.section}>
      <h2 style={sty.sectionTitle}>
        <span style={{ color: '#d9534f' }}>LIVE</span> Bank Testing
      </h2>
      <p style={sty.sectionDesc}>
        Test real bank logins with actual credentials. Requires the local Puppeteer server.
      </p>

      {/* Server Status */}
      <div style={{ ...sty.badge, backgroundColor: serverOnline ? '#e8f5e9' : serverOnline === false ? '#fce4ec' : '#f5f5f5' }}>
        <span style={{
          ...sty.dot,
          backgroundColor: serverOnline ? '#4caf50' : serverOnline === false ? '#f44336' : '#aaa',
        }} />
        {serverOnline === null && 'Checking server...'}
        {serverOnline === true && 'Live server connected (localhost:3001)'}
        {serverOnline === false && (
          <span>
            Server offline —{' '}
            <code style={{ fontSize: 12, backgroundColor: '#fff', padding: '2px 6px', borderRadius: 4 }}>
              cd server && npm install && npm start
            </code>
          </span>
        )}
      </div>

      {serverOnline === false && (
        <div style={sty.instructions}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Setup Instructions</h3>
          <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 2 }}>
            <li>Open a terminal in the <code>conduit/server/</code> directory</li>
            <li>Run <code>npm install</code> (installs Puppeteer + Express)</li>
            <li>Run <code>npm start</code></li>
            <li>Come back here — this panel will auto-detect the server</li>
          </ol>
          <p style={{ margin: '12px 0 0', fontSize: 13, color: '#888' }}>
            The server runs Puppeteer (headless Chrome) locally. Your credentials are never stored
            or sent to any external service.
          </p>
        </div>
      )}

      {serverOnline && (
        <>
          {/* Login Form */}
          <div style={sty.form}>
            <div style={sty.formRow}>
              <label style={sty.label}>Bank</label>
              <select
                value={selectedBank}
                onChange={e => setSelectedBank(e.target.value)}
                style={sty.select}
                disabled={isActive}
              >
                {banks.map(b => (
                  <option key={b.bankId} value={b.bankId}>{b.name}</option>
                ))}
              </select>
            </div>

            <div style={sty.formRow}>
              <label style={sty.label}>Username</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Your bank username"
                style={sty.input}
                disabled={isActive}
                autoComplete="off"
              />
            </div>

            <div style={sty.formRow}>
              <label style={sty.label}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Your bank password"
                style={sty.input}
                disabled={isActive}
                autoComplete="off"
              />
            </div>

            <div style={sty.formRow}>
              {session.status === 'idle' ? (
                <button
                  onClick={startSession}
                  disabled={!username || !password}
                  style={{ ...sty.btn, ...sty.btnPrimary, opacity: (!username || !password) ? 0.5 : 1 }}
                >
                  Connect to Bank
                </button>
              ) : isActive ? (
                <button onClick={cancelSession} style={{ ...sty.btn, ...sty.btnDanger }}>
                  Cancel
                </button>
              ) : (
                <button onClick={reset} style={{ ...sty.btn, ...sty.btnSecondary }}>
                  Start New Session
                </button>
              )}
            </div>
          </div>

          {/* MFA Input */}
          {session.status === 'mfa_required' && (
            <div style={sty.mfaBox}>
              <p style={{ margin: '0 0 8px', fontWeight: 600 }}>
                Multi-Factor Authentication Required
              </p>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: '#666' }}>
                Check your phone or email for the verification code.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={mfaCode}
                  onChange={e => setMfaCode(e.target.value)}
                  placeholder="Enter verification code"
                  style={{ ...sty.input, flex: 1 }}
                  onKeyDown={e => e.key === 'Enter' && submitMfa()}
                />
                <button
                  onClick={submitMfa}
                  disabled={!mfaCode}
                  style={{ ...sty.btn, ...sty.btnPrimary }}
                >
                  Submit
                </button>
              </div>
            </div>
          )}

          {/* Session Status & Preview */}
          {session.status !== 'idle' && (
            <div style={sty.sessionPanel}>
              {/* Status Bar */}
              <div style={sty.statusBar}>
                <span style={{
                  ...sty.dot,
                  backgroundColor: session.status === 'success' ? '#4caf50'
                    : session.status === 'failed' ? '#f44336'
                    : session.status === 'cancelled' ? '#aaa'
                    : session.status === 'mfa_required' ? '#ff9800'
                    : '#2196f3',
                }} />
                <span style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: 12, letterSpacing: 0.5 }}>
                  {session.status.replace('_', ' ')}
                </span>
                <span style={{ color: '#666', marginLeft: 8, fontSize: 13 }}>
                  {session.caption}
                </span>
              </div>

              {/* Screenshot Preview */}
              <div style={sty.screenshotContainer}>
                {screenshotUrl ? (
                  <img
                    src={screenshotUrl}
                    alt="Browser preview"
                    style={sty.screenshot}
                  />
                ) : (
                  <div style={sty.screenshotPlaceholder}>
                    {isActive ? (
                      <>
                        <div style={sty.spinner} />
                        <span style={{ color: '#888', fontSize: 13 }}>Waiting for screenshot...</span>
                      </>
                    ) : (
                      <span style={{ color: '#888', fontSize: 13 }}>
                        {session.status === 'success' ? 'Session complete' : 'No preview available'}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Event Log */}
              <details style={sty.eventLog}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13, color: '#555' }}>
                  Event Log ({session.events.length} events)
                </summary>
                <div style={sty.eventList}>
                  {session.events.map((e, i) => (
                    <div key={i} style={sty.eventItem}>
                      <span style={{ color: '#888', fontSize: 11, fontFamily: 'monospace' }}>
                        {new Date(e.timestamp).toLocaleTimeString()}
                      </span>
                      <span style={{
                        ...sty.eventType,
                        backgroundColor: e.type === 'error' ? '#fce4ec'
                          : e.type === 'status' ? '#e3f2fd'
                          : e.type === 'mfa_required' ? '#fff3e0'
                          : '#f5f5f5',
                      }}>
                        {e.type}
                      </span>
                      <span style={{ fontSize: 12, color: '#555' }}>
                        {String(e.caption || e.error || e.status || '')}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </>
      )}
    </section>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────

const sty: Record<string, React.CSSProperties> = {
  section: {
    backgroundColor: '#fff',
    border: '2px solid #d9534f',
    borderRadius: 12,
    padding: 24,
    marginTop: 24,
  },
  sectionTitle: { margin: '0 0 4px', fontSize: 20 },
  sectionDesc: { color: '#666', margin: '0 0 16px', fontSize: 14, lineHeight: 1.5 },
  badge: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    borderRadius: 8,
    fontSize: 14,
    marginBottom: 16,
  },
  dot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  instructions: {
    backgroundColor: '#f8f9fa',
    border: '1px solid #e0e0e0',
    borderRadius: 8,
    padding: 20,
    marginBottom: 16,
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    marginBottom: 16,
  },
  formRow: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  label: { fontSize: 13, fontWeight: 600, color: '#555' },
  input: {
    padding: '10px 14px',
    border: '1px solid #ddd',
    borderRadius: 8,
    fontSize: 14,
    boxSizing: 'border-box' as const,
  },
  select: {
    padding: '10px 14px',
    border: '1px solid #ddd',
    borderRadius: 8,
    fontSize: 14,
    backgroundColor: '#fff',
  },
  btn: {
    padding: '10px 20px',
    borderRadius: 8,
    border: '1px solid #ccc',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
  },
  btnPrimary: { backgroundColor: '#0275d8', color: '#fff', borderColor: '#0275d8' },
  btnDanger: { backgroundColor: '#d9534f', color: '#fff', borderColor: '#d9534f' },
  btnSecondary: { backgroundColor: '#f0f0f0', color: '#333' },
  mfaBox: {
    backgroundColor: '#fff3e0',
    border: '1px solid #ffcc80',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  sessionPanel: {
    border: '1px solid #e0e0e0',
    borderRadius: 8,
    overflow: 'hidden' as const,
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    backgroundColor: '#f8f9fa',
    borderBottom: '1px solid #e0e0e0',
  },
  screenshotContainer: {
    position: 'relative' as const,
    backgroundColor: '#1a1a1a',
    minHeight: 240,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenshot: {
    width: '100%',
    height: 'auto',
    display: 'block',
  },
  screenshotPlaceholder: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 12,
    padding: 40,
  },
  spinner: {
    width: 24,
    height: 24,
    border: '3px solid #444',
    borderTopColor: '#0275d8',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  eventLog: {
    borderTop: '1px solid #e0e0e0',
    padding: 12,
  },
  eventList: {
    maxHeight: 200,
    overflowY: 'auto' as const,
    marginTop: 8,
  },
  eventItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 0',
    borderBottom: '1px solid #f0f0f0',
  },
  eventType: {
    padding: '2px 6px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    fontFamily: 'monospace',
  },
}
