import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  createConduitPreview,
  IDLE_PREVIEW_STATE,
  PreviewStatus,
  createDefaultRegistry,
  LinkSessionPhase,
  AccountType,
} from '@conduit/sdk'
import type { PreviewState } from '@conduit/sdk'

// Create the preview component using the factory
const ConduitPreview = createConduitPreview(React) as React.FC<{
  state: PreviewState
  width?: number
  height?: number
  showCaption?: boolean
  showProgress?: boolean
  style?: Record<string, unknown>
  onPress?: () => void
  testID?: string
}>

// ─── Simulated Link Flow ─────────────────────────────────────────────

interface SimulationStep {
  status: string
  caption: string
  progress: number | null
  duration: number
}

const LINK_FLOW_STEPS: SimulationStep[] = [
  { status: PreviewStatus.Loading, caption: 'Initializing secure connection...', progress: 0.05, duration: 800 },
  { status: PreviewStatus.Loading, caption: 'Connecting to Chase...', progress: 0.15, duration: 1200 },
  { status: PreviewStatus.Active, caption: 'Loading login page', progress: 0.25, duration: 1000 },
  { status: PreviewStatus.Active, caption: 'Entering credentials...', progress: 0.35, duration: 1500 },
  { status: PreviewStatus.Active, caption: 'Submitting login form', progress: 0.45, duration: 2000 },
  { status: PreviewStatus.Active, caption: 'MFA required — waiting for code...', progress: 0.50, duration: 3000 },
  { status: PreviewStatus.Active, caption: 'Submitting verification code', progress: 0.60, duration: 1500 },
  { status: PreviewStatus.Active, caption: 'Authenticated — extracting accounts', progress: 0.70, duration: 2000 },
  { status: PreviewStatus.Active, caption: 'Found 3 accounts — reading balances', progress: 0.80, duration: 1500 },
  { status: PreviewStatus.Active, caption: 'Extracting transactions...', progress: 0.90, duration: 2000 },
  { status: PreviewStatus.Active, caption: 'Extracting routing & account numbers', progress: 0.95, duration: 1000 },
  { status: PreviewStatus.Complete, caption: 'Done — 3 accounts linked', progress: 1.0, duration: 0 },
]

const ERROR_FLOW_STEPS: SimulationStep[] = [
  { status: PreviewStatus.Loading, caption: 'Initializing secure connection...', progress: 0.05, duration: 800 },
  { status: PreviewStatus.Loading, caption: 'Connecting to Wells Fargo...', progress: 0.15, duration: 1200 },
  { status: PreviewStatus.Active, caption: 'Loading login page', progress: 0.25, duration: 1000 },
  { status: PreviewStatus.Active, caption: 'Entering credentials...', progress: 0.35, duration: 1500 },
  { status: PreviewStatus.Error, caption: 'Login failed — invalid credentials', progress: null, duration: 0 },
]

// ─── Preview Demo Section ────────────────────────────────────────────

function PreviewDemo() {
  const [previewState, setPreviewState] = useState<PreviewState>(IDLE_PREVIEW_STATE)
  const [isRunning, setIsRunning] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const runFlow = useCallback((steps: SimulationStep[]) => {
    setIsRunning(true)
    let stepIndex = 0

    function next() {
      if (stepIndex >= steps.length) {
        setIsRunning(false)
        return
      }
      const step = steps[stepIndex]!
      setPreviewState({
        status: step.status as PreviewState['status'],
        caption: step.caption,
        progress: step.progress,
      })
      stepIndex++
      if (step.duration > 0) {
        timeoutRef.current = setTimeout(next, step.duration)
      } else {
        setIsRunning(false)
      }
    }
    next()
  }, [])

  const reset = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setIsRunning(false)
    setPreviewState(IDLE_PREVIEW_STATE)
  }, [])

  useEffect(() => {
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) }
  }, [])

  const previewWidth = expanded ? 480 : 320
  const previewHeight = expanded ? 360 : 200

  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>Live Preview Component</h2>
      <p style={styles.sectionDesc}>
        The <code>createConduitPreview(React)</code> factory creates a component that
        renders a live, minimized view of the bank connection flow.
      </p>

      <div style={styles.previewContainer}>
        <ConduitPreview
          state={previewState}
          width={previewWidth}
          height={previewHeight}
          showCaption={true}
          showProgress={true}
          onPress={() => setExpanded(!expanded)}
          style={{
            transition: 'all 0.3s ease',
            cursor: 'pointer',
            boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
            border: '1px solid #e0e0e0',
          }}
          testID="demo-preview"
        />
      </div>

      <div style={styles.statusBadge}>
        <span style={{
          ...styles.dot,
          backgroundColor: previewState.status === 'idle' ? '#aaa'
            : previewState.status === 'loading' ? '#f0ad4e'
            : previewState.status === 'active' ? '#0275d8'
            : previewState.status === 'complete' ? '#5cb85c'
            : '#d9534f'
        }} />
        <strong>{previewState.status.toUpperCase()}</strong>
        {previewState.caption && <span style={{ color: '#666', marginLeft: 8 }}>— {previewState.caption}</span>}
      </div>

      {previewState.progress !== null && (
        <div style={styles.progressBar}>
          <div style={{ ...styles.progressFill, width: `${Math.round(previewState.progress * 100)}%` }} />
        </div>
      )}

      <div style={styles.buttonRow}>
        <button
          style={{ ...styles.btn, ...styles.btnPrimary }}
          onClick={() => runFlow(LINK_FLOW_STEPS)}
          disabled={isRunning}
        >
          Run Happy Path
        </button>
        <button
          style={{ ...styles.btn, ...styles.btnDanger }}
          onClick={() => runFlow(ERROR_FLOW_STEPS)}
          disabled={isRunning}
        >
          Run Error Flow
        </button>
        <button
          style={{ ...styles.btn, ...styles.btnSecondary }}
          onClick={reset}
        >
          Reset
        </button>
        <button
          style={{ ...styles.btn, ...styles.btnOutline }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
    </section>
  )
}

// ─── Bank Selector Demo ──────────────────────────────────────────────

function BankSelectorDemo() {
  const [query, setQuery] = useState('')
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null)
  const registryRef = useRef(createDefaultRegistry())

  const banks = query.trim()
    ? registryRef.current.search({ query: query.trim() })
    : registryRef.current.list()

  const selectedBank = selectedBankId
    ? banks.find(b => b.bankId === selectedBankId) ?? null
    : null

  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>Bank Selector</h2>
      <p style={styles.sectionDesc}>
        The <code>BankAdapterRegistry</code> provides searchable bank data.
        The <code>BankSelectorController</code> wraps it with headless UI state management.
      </p>

      <input
        type="text"
        placeholder="Search banks..."
        value={query}
        onChange={e => { setQuery(e.target.value); setSelectedBankId(null) }}
        style={styles.searchInput}
      />

      <div style={styles.bankGrid}>
        {banks.map(bank => (
          <div
            key={bank.bankId}
            onClick={() => setSelectedBankId(bank.bankId === selectedBankId ? null : bank.bankId)}
            style={{
              ...styles.bankCard,
              borderColor: bank.bankId === selectedBankId ? '#0275d8' : '#e0e0e0',
              backgroundColor: bank.bankId === selectedBankId ? '#e8f4ff' : '#fff',
            }}
          >
            <div style={styles.bankIcon}>{bank.displayName.charAt(0)}</div>
            <div>
              <div style={{ fontWeight: 600 }}>{bank.displayName}</div>
              <div style={{ fontSize: 12, color: '#888' }}>{bank.bankId}</div>
            </div>
          </div>
        ))}
      </div>

      {selectedBank && (
        <div style={styles.selectedBankInfo}>
          <strong>Selected:</strong> {selectedBank.displayName} ({selectedBank.bankId})
          <br />
          <span style={{ fontSize: 13, color: '#555' }}>
            Supported features: {selectedBank.supportedFeatures.join(', ')}
          </span>
        </div>
      )}
    </section>
  )
}

// ─── State Machine Demo ──────────────────────────────────────────────

function StateMachineDemo() {
  const phases = Object.values(LinkSessionPhase)
  const [currentPhase, setCurrentPhase] = useState(LinkSessionPhase.Created)

  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>Link Session State Machine</h2>
      <p style={styles.sectionDesc}>
        The SDK enforces a strict state machine for the link session lifecycle.
        Each <code>LinkSession</code> state carries only the data relevant to that phase.
      </p>

      <div style={styles.stateRow}>
        {phases.map(phase => (
          <div
            key={phase}
            onClick={() => setCurrentPhase(phase)}
            style={{
              ...styles.stateChip,
              backgroundColor: phase === currentPhase ? '#0275d8' : '#f0f0f0',
              color: phase === currentPhase ? '#fff' : '#333',
            }}
          >
            {phase}
          </div>
        ))}
      </div>

      <div style={styles.codeBlock}>
        <pre>{JSON.stringify(buildExampleSession(currentPhase), null, 2)}</pre>
      </div>
    </section>
  )
}

function buildExampleSession(phase: string) {
  const base = { sessionId: 'sess_demo_123', phase, startedAt: Date.now() }
  switch (phase) {
    case LinkSessionPhase.Created:
      return { ...base, clientId: 'client_abc' }
    case LinkSessionPhase.InstitutionSelected:
      return { ...base, institutionId: 'chase', institutionName: 'Chase' }
    case LinkSessionPhase.Authenticating:
      return { ...base, institutionId: 'chase', credentials: { username: '***', password: '***' } }
    case LinkSessionPhase.MfaRequired:
      return { ...base, institutionId: 'chase', mfaChallengeType: 'sms_code', maskedTarget: '***-1234' }
    case LinkSessionPhase.Extracting:
      return { ...base, institutionId: 'chase', accountsFound: 3, progress: 0.65 }
    case LinkSessionPhase.Succeeded:
      return {
        ...base, institutionId: 'chase',
        accounts: [
          { name: 'Total Checking', type: AccountType.Checking, balance: 4821.50 },
          { name: 'Savings', type: AccountType.Savings, balance: 12340.00 },
          { name: 'Freedom Card', type: AccountType.Credit, balance: -1523.44 },
        ],
        transactionCount: 147,
      }
    case LinkSessionPhase.Failed:
      return { ...base, errorCode: 'AUTH_FAILED', errorMessage: 'Invalid credentials' }
    case LinkSessionPhase.Cancelled:
      return { ...base, cancelledBy: 'user', cancelledAt: Date.now() }
    default:
      return base
  }
}

// ─── Type System Demo ────────────────────────────────────────────────

function TypeSystemDemo() {
  const types = [
    { name: 'PreviewStatus', values: Object.entries(PreviewStatus).map(([k, v]) => `${k}: "${v}"`) },
    { name: 'AccountType', values: Object.entries(AccountType).map(([k, v]) => `${k}: "${v}"`) },
    { name: 'LinkSessionPhase', values: Object.entries(LinkSessionPhase).map(([k, v]) => `${k}: "${v}"`) },
  ]

  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>Type System</h2>
      <p style={styles.sectionDesc}>
        All enums use the <code>as const</code> pattern for runtime values + full TypeScript type safety.
        No string typos possible.
      </p>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {types.map(t => (
          <div key={t.name} style={styles.typeCard}>
            <div style={{ fontWeight: 700, marginBottom: 8, color: '#0275d8' }}>{t.name}</div>
            {t.values.map(v => (
              <div key={v} style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.8 }}>{v}</div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── App ─────────────────────────────────────────────────────────────

export default function App() {
  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <h1 style={styles.logo}>
            <span style={{ color: '#0275d8' }}>conduit</span>
            <span style={{ fontSize: 14, fontWeight: 400, color: '#888', marginLeft: 8 }}>SDK demo</span>
          </h1>
          <a
            href="https://github.com/eastseymour/conduit"
            target="_blank"
            rel="noopener"
            style={styles.ghLink}
          >
            GitHub
          </a>
        </div>
      </header>

      <main style={styles.main}>
        <div style={styles.hero}>
          <h2 style={{ fontSize: 28, margin: 0 }}>Interactive SDK Playground</h2>
          <p style={{ color: '#666', maxWidth: 600, margin: '8px auto 0' }}>
            Explore the Conduit SDK components — preview, bank selector, state machine, and type system.
            Everything below is rendered using the actual SDK exports.
          </p>
        </div>

        <PreviewDemo />
        <BankSelectorDemo />
        <StateMachineDemo />
        <TypeSystemDemo />
      </main>

      <footer style={styles.footer}>
        <code>@conduit/sdk v0.1.0</code> — 642 tests passing — 0 ESLint errors
      </footer>
    </div>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  app: {
    minHeight: '100vh',
    backgroundColor: '#fafafa',
    color: '#222',
  },
  header: {
    backgroundColor: '#fff',
    borderBottom: '1px solid #e0e0e0',
    padding: '12px 24px',
    position: 'sticky' as const,
    top: 0,
    zIndex: 100,
  },
  headerInner: {
    maxWidth: 900,
    margin: '0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logo: { margin: 0, fontSize: 22 },
  ghLink: {
    color: '#555',
    textDecoration: 'none',
    fontSize: 14,
    padding: '6px 12px',
    border: '1px solid #ddd',
    borderRadius: 6,
  },
  main: { maxWidth: 900, margin: '0 auto', padding: '0 24px 48px' },
  hero: { textAlign: 'center' as const, padding: '40px 0 24px' },
  section: {
    backgroundColor: '#fff',
    border: '1px solid #e0e0e0',
    borderRadius: 12,
    padding: 24,
    marginTop: 24,
  },
  sectionTitle: { margin: '0 0 4px', fontSize: 20 },
  sectionDesc: { color: '#666', margin: '0 0 16px', fontSize: 14, lineHeight: 1.5 },
  previewContainer: { display: 'flex', justifyContent: 'center', marginBottom: 16 },
  statusBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    backgroundColor: '#f8f8f8',
    borderRadius: 8,
    fontSize: 14,
    marginBottom: 12,
  },
  dot: { width: 10, height: 10, borderRadius: '50%' },
  progressBar: {
    height: 6,
    backgroundColor: '#e0e0e0',
    borderRadius: 3,
    overflow: 'hidden' as const,
    marginBottom: 16,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#0275d8',
    borderRadius: 3,
    transition: 'width 0.5s ease',
  },
  buttonRow: { display: 'flex', gap: 8, flexWrap: 'wrap' as const },
  btn: {
    padding: '8px 16px',
    borderRadius: 6,
    border: '1px solid #ccc',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
  },
  btnPrimary: { backgroundColor: '#0275d8', color: '#fff', borderColor: '#0275d8' },
  btnDanger: { backgroundColor: '#d9534f', color: '#fff', borderColor: '#d9534f' },
  btnSecondary: { backgroundColor: '#f0f0f0', color: '#333' },
  btnOutline: { backgroundColor: 'transparent', color: '#0275d8', borderColor: '#0275d8' },
  searchInput: {
    width: '100%',
    padding: '10px 14px',
    border: '1px solid #ddd',
    borderRadius: 8,
    fontSize: 14,
    marginBottom: 12,
    boxSizing: 'border-box' as const,
  },
  bankGrid: { display: 'flex', gap: 12, flexWrap: 'wrap' as const },
  bankCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    border: '2px solid #e0e0e0',
    borderRadius: 10,
    cursor: 'pointer',
    transition: 'all 0.15s',
    minWidth: 200,
    flex: '1 1 200px',
  },
  bankIcon: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    backgroundColor: '#0275d8',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: 16,
    flexShrink: 0,
  },
  selectedBankInfo: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#e8f4ff',
    borderRadius: 8,
    fontSize: 14,
  },
  stateRow: { display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginBottom: 16 },
  stateChip: {
    padding: '6px 14px',
    borderRadius: 20,
    fontSize: 13,
    cursor: 'pointer',
    fontWeight: 500,
    transition: 'all 0.15s',
  },
  codeBlock: {
    backgroundColor: '#1e1e1e',
    color: '#d4d4d4',
    padding: 16,
    borderRadius: 8,
    overflow: 'auto' as const,
    fontSize: 13,
    lineHeight: 1.5,
  },
  typeCard: {
    backgroundColor: '#f8f9fa',
    border: '1px solid #e0e0e0',
    borderRadius: 8,
    padding: 16,
    flex: '1 1 250px',
  },
  footer: {
    textAlign: 'center' as const,
    padding: '24px 0',
    color: '#888',
    fontSize: 13,
    borderTop: '1px solid #eee',
    marginTop: 48,
  },
}
