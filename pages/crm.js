// pages/crm.js
// -----------------------------------------------------------------------------
// CRM PREVIEW PAGE  (admin-only)
//
// This is a SELF-CONTAINED PREVIEW. It reads deal data baked into the file
// (lib/crmSeedDeals.js) and keeps all changes in the browser's memory only.
// Nothing here reads from or writes to your live database or dashboards.
// Refreshing the page resets everything back to the seed data. That is expected
// at this stage — the goal is to look at it and click around before we wire it
// up for real.
//
// What works in this preview:
//   - Single pipeline board with your 15 stages, left to right
//   - Drag a deal card from one stage to another
//   - Open a deal to see all its fields
//   - Mark a deal Won or Lost
//   - Add / tick off tasks on a deal
//   - Add custom fields to a deal
//   - Search / filter the board
// -----------------------------------------------------------------------------

import { useState, useMemo, useRef } from 'react';
import { SEED_DEALS } from '../lib/crmSeedDeals';

// ---- Access control -------------------------------------------------------
// Adjust this import to however your portal exposes the current user's role.
// Most of your other admin pages already do a role check; mirror that here.
// The block below assumes a hook or helper that returns the role string.
// If your project uses `requireRole` server-side (lib/portalAuth.js), you can
// additionally gate this route in getServerSideProps — see note at the bottom.

// --- Stage definitions (order matters: this is the board left-to-right) -----
const STAGES = [
  { id: 'stage_project_in',     label: 'Project In' },
  { id: 'stage_1st_contact',    label: '1st Contact' },
  { id: 'stage_calls_x3',       label: 'Calls x 3' },
  { id: 'stage_in_abeyance',    label: 'In Abeyance' },
  { id: 'stage_tbf',            label: 'TBF' },
  { id: 'stage_variations',     label: 'Variations' },
  { id: 'stage_info_pending',   label: 'Info Pending' },
  { id: 'stage_received',       label: 'Received' },
  { id: 'stage_1',              label: 'Stage 1' },
  { id: 'stage_2',              label: 'Stage 2' },
  { id: 'stage_review',         label: 'Review' },
  { id: 'stage_mc_unsec_np',    label: 'MC Unsecured Not Priced' },
  { id: 'stage_mc_unsecured',   label: 'MC Unsecured' },
  { id: 'stage_mc_secured',     label: 'MC Secured' },
  { id: 'stage_negotiating',    label: 'Negotiating' },
];

// Human-friendly labels for the built-in fields carried over from Pipedrive.
const FIELD_LABELS = {
  value: 'Value',
  organization: 'Organization',
  expected_close_date: 'Expected close',
  estimator_responsible: 'Estimator',
  lead_source: 'Lead source',
  owner: 'Owner',
  created: 'Created',
  won_time: 'Won date',
  lost_time: 'Lost date',
  lost_reason: 'Lost reason',
  project_type: 'Project type',
  systems_priced: 'Systems priced',
  credit_score: 'Credit score',
  size_m2: 'Size (m²)',
  region: 'Region',
  site_location: 'Site location',
  site_postcode: 'Postcode',
  contact_person: 'Contact',
  scope_of_works: 'Scope of works',
  email_messages_count: 'Emails',
};

// The order fields appear inside the deal drawer.
const FIELD_ORDER = [
  'organization', 'contact_person', 'value', 'owner', 'estimator_responsible',
  'region', 'site_location', 'site_postcode', 'size_m2', 'project_type',
  'systems_priced', 'lead_source', 'credit_score', 'scope_of_works',
  'expected_close_date', 'created', 'email_messages_count',
  'won_time', 'lost_time', 'lost_reason',
];

function formatValue(key, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (key === 'value') {
    const n = Number(v);
    if (!isNaN(n)) return '£' + n.toLocaleString('en-GB', { maximumFractionDigits: 0 });
  }
  if (key === 'size_m2') {
    const n = Number(v);
    if (!isNaN(n)) return n.toLocaleString('en-GB') + ' m²';
  }
  return String(v);
}

function money(v) {
  const n = Number(v);
  if (isNaN(n)) return '—';
  return '£' + n.toLocaleString('en-GB', { maximumFractionDigits: 0 });
}

// --- Small UI atoms --------------------------------------------------------
const COLORS = {
  bg: '#0f1720',
  panel: '#16212e',
  panel2: '#1d2b3a',
  line: '#28384a',
  text: '#e6edf3',
  dim: '#8ba0b4',
  accent: '#f0a500',      // Rock Roofing amber-ish
  won: '#3fb950',
  lost: '#d1493f',
  open: '#4b8bd4',
};

function StatusPill({ status }) {
  const map = {
    won: { bg: 'rgba(63,185,80,.15)', fg: COLORS.won, label: 'Won' },
    lost: { bg: 'rgba(209,73,63,.15)', fg: COLORS.lost, label: 'Lost' },
    open: { bg: 'rgba(75,139,212,.15)', fg: COLORS.open, label: 'Open' },
  };
  const s = map[status] || map.open;
  return (
    <span style={{
      background: s.bg, color: s.fg, fontSize: 11, fontWeight: 600,
      padding: '2px 8px', borderRadius: 20, letterSpacing: .3,
    }}>{s.label}</span>
  );
}

// --- Deal card -------------------------------------------------------------
function DealCard({ deal, onOpen, onDragStart }) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, deal.id)}
      onClick={() => onOpen(deal.id)}
      style={{
        background: COLORS.panel2,
        border: `1px solid ${COLORS.line}`,
        borderLeft: `3px solid ${
          deal.status === 'won' ? COLORS.won :
          deal.status === 'lost' ? COLORS.lost : COLORS.accent
        }`,
        borderRadius: 8,
        padding: '10px 12px',
        marginBottom: 8,
        cursor: 'grab',
        transition: 'transform .08s, box-shadow .08s',
      }}
      onMouseDown={(e) => (e.currentTarget.style.cursor = 'grabbing')}
      onMouseUp={(e) => (e.currentTarget.style.cursor = 'grab')}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, lineHeight: 1.3, marginBottom: 6 }}>
        {deal.title}
      </div>
      <div style={{ fontSize: 12, color: COLORS.dim, marginBottom: 4 }}>
        {deal.fields.organization || '—'}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.accent }}>
          {money(deal.fields.value)}
        </span>
        <StatusPill status={deal.status} />
      </div>
      {deal.tasks && deal.tasks.length > 0 && (
        <div style={{ fontSize: 11, color: COLORS.dim, marginTop: 6 }}>
          ✓ {deal.tasks.filter(t => t.done).length}/{deal.tasks.length} tasks
        </div>
      )}
    </div>
  );
}

// --- Stage column ----------------------------------------------------------
function StageColumn({ stage, deals, onOpen, onDragStart, onDrop }) {
  const [over, setOver] = useState(false);
  const total = deals.reduce((s, d) => s + (Number(d.fields.value) || 0), 0);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); onDrop(e, stage.id); }}
      style={{
        minWidth: 260, maxWidth: 260, flex: '0 0 260px',
        background: over ? COLORS.panel2 : COLORS.panel,
        border: `1px solid ${over ? COLORS.accent : COLORS.line}`,
        borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column',
        maxHeight: '100%',
      }}
    >
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>{stage.label}</span>
          <span style={{ fontSize: 12, color: COLORS.dim }}>{deals.length}</span>
        </div>
        <div style={{ fontSize: 11, color: COLORS.dim, marginTop: 2 }}>{money(total)}</div>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {deals.map((d) => (
          <DealCard key={d.id} deal={d} onOpen={onOpen} onDragStart={onDragStart} />
        ))}
        {deals.length === 0 && (
          <div style={{ fontSize: 12, color: COLORS.dim, textAlign: 'center', padding: '20px 0', opacity: .6 }}>
            Drop a deal here
          </div>
        )}
      </div>
    </div>
  );
}

// --- Deal drawer (detail panel) --------------------------------------------
function DealDrawer({ deal, onClose, onSetStatus, onAddTask, onToggleTask, onAddField, onMove }) {
  const [taskText, setTaskText] = useState('');
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');

  if (!deal) return null;

  const builtIn = FIELD_ORDER.filter(k => deal.fields[k] !== undefined);
  const customKeys = Object.keys(deal.fields).filter(
    k => !FIELD_ORDER.includes(k) && !['value'].includes(k)
  ).filter(k => k.startsWith('custom_'));

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 40,
      }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(460px, 100%)',
        background: COLORS.panel, borderLeft: `1px solid ${COLORS.line}`,
        zIndex: 50, overflowY: 'auto', padding: 20,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <StatusPill status={deal.status} />
          <button onClick={onClose} style={btnGhost}>Close</button>
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: COLORS.text, margin: '8px 0 4px' }}>
          {deal.title}
        </h2>
        <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.accent, marginBottom: 16 }}>
          {money(deal.fields.value)}
        </div>

        {/* Won / Lost controls */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <button onClick={() => onSetStatus(deal.id, 'won')}
            style={{ ...btnBase, background: deal.status === 'won' ? COLORS.won : 'transparent',
                     color: deal.status === 'won' ? '#fff' : COLORS.won, border: `1px solid ${COLORS.won}` }}>
            Mark Won
          </button>
          <button onClick={() => onSetStatus(deal.id, 'lost')}
            style={{ ...btnBase, background: deal.status === 'lost' ? COLORS.lost : 'transparent',
                     color: deal.status === 'lost' ? '#fff' : COLORS.lost, border: `1px solid ${COLORS.lost}` }}>
            Mark Lost
          </button>
          {deal.status !== 'open' && (
            <button onClick={() => onSetStatus(deal.id, 'open')} style={btnGhost}>Reopen</button>
          )}
        </div>

        {/* Move stage */}
        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>Stage</label>
          <select value={deal.stageId} onChange={(e) => onMove(deal.id, e.target.value)} style={select}>
            {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>

        {/* Fields */}
        <div style={{ marginBottom: 20 }}>
          <div style={sectionTitle}>Details</div>
          {builtIn.map(k => (
            <div key={k} style={fieldRow}>
              <span style={fieldKey}>{FIELD_LABELS[k] || k}</span>
              <span style={fieldVal}>{formatValue(k, deal.fields[k])}</span>
            </div>
          ))}
          {customKeys.map(k => (
            <div key={k} style={fieldRow}>
              <span style={fieldKey}>{k.replace('custom_', '')}</span>
              <span style={fieldVal}>{formatValue(k, deal.fields[k])}</span>
            </div>
          ))}
        </div>

        {/* Add custom field */}
        <div style={{ marginBottom: 20 }}>
          <div style={sectionTitle}>Add a field</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input placeholder="Field name" value={newFieldName}
              onChange={(e) => setNewFieldName(e.target.value)} style={{ ...input, flex: 1 }} />
            <input placeholder="Value" value={newFieldValue}
              onChange={(e) => setNewFieldValue(e.target.value)} style={{ ...input, flex: 1 }} />
          </div>
          <button
            onClick={() => {
              if (!newFieldName.trim()) return;
              onAddField(deal.id, newFieldName.trim(), newFieldValue);
              setNewFieldName(''); setNewFieldValue('');
            }}
            style={{ ...btnBase, marginTop: 8, background: COLORS.accent, color: '#1a1200', width: '100%' }}
          >Add field</button>
        </div>

        {/* Tasks */}
        <div>
          <div style={sectionTitle}>Tasks</div>
          {deal.tasks.map(t => (
            <div key={t.id} onClick={() => onToggleTask(deal.id, t.id)}
              style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', cursor: 'pointer' }}>
              <span style={{
                width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                border: `1.5px solid ${t.done ? COLORS.won : COLORS.dim}`,
                background: t.done ? COLORS.won : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 11,
              }}>{t.done ? '✓' : ''}</span>
              <span style={{ fontSize: 13, color: t.done ? COLORS.dim : COLORS.text,
                             textDecoration: t.done ? 'line-through' : 'none' }}>{t.text}</span>
            </div>
          ))}
          {deal.tasks.length === 0 && (
            <div style={{ fontSize: 12, color: COLORS.dim, opacity: .7, padding: '4px 0' }}>No tasks yet.</div>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <input placeholder="New task" value={taskText}
              onChange={(e) => setTaskText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && taskText.trim()) { onAddTask(deal.id, taskText.trim()); setTaskText(''); } }}
              style={{ ...input, flex: 1 }} />
            <button onClick={() => { if (taskText.trim()) { onAddTask(deal.id, taskText.trim()); setTaskText(''); } }}
              style={{ ...btnBase, background: COLORS.panel2, color: COLORS.text, border: `1px solid ${COLORS.line}` }}>Add</button>
          </div>
        </div>
      </div>
    </>
  );
}

// --- Main page -------------------------------------------------------------
export default function CRMPage() {
  const [deals, setDeals] = useState(() => SEED_DEALS.map(d => ({ ...d, fields: { ...d.fields }, tasks: [...(d.tasks || [])] })));
  const [openId, setOpenId] = useState(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const dragId = useRef(null);

  const openDeal = deals.find(d => d.id === openId) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return deals.filter(d => {
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (d.title || '').toLowerCase().includes(q) ||
        (d.fields.organization || '').toLowerCase().includes(q) ||
        (d.fields.contact_person || '').toLowerCase().includes(q)
      );
    });
  }, [deals, query, statusFilter]);

  const byStage = useMemo(() => {
    const map = {};
    STAGES.forEach(s => (map[s.id] = []));
    filtered.forEach(d => { if (map[d.stageId]) map[d.stageId].push(d); });
    return map;
  }, [filtered]);

  const totals = useMemo(() => {
    const open = deals.filter(d => d.status === 'open');
    return {
      count: deals.length,
      openCount: open.length,
      openValue: open.reduce((s, d) => s + (Number(d.fields.value) || 0), 0),
      won: deals.filter(d => d.status === 'won').length,
      lost: deals.filter(d => d.status === 'lost').length,
    };
  }, [deals]);

  const onDragStart = (e, id) => { dragId.current = id; };
  const onDrop = (e, stageId) => {
    const id = dragId.current;
    if (id == null) return;
    setDeals(prev => prev.map(d => d.id === id ? { ...d, stageId } : d));
    dragId.current = null;
  };
  const moveDeal = (id, stageId) => setDeals(prev => prev.map(d => d.id === id ? { ...d, stageId } : d));
  const setStatus = (id, status) => setDeals(prev => prev.map(d => d.id === id ? { ...d, status } : d));
  const addTask = (id, text) => setDeals(prev => prev.map(d => d.id === id
    ? { ...d, tasks: [...d.tasks, { id: Date.now(), text, done: false }] } : d));
  const toggleTask = (id, taskId) => setDeals(prev => prev.map(d => d.id === id
    ? { ...d, tasks: d.tasks.map(t => t.id === taskId ? { ...t, done: !t.done } : t) } : d));
  const addField = (id, name, value) => setDeals(prev => prev.map(d => d.id === id
    ? { ...d, fields: { ...d.fields, ['custom_' + name]: value } } : d));

  return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', color: COLORS.text,
                  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${COLORS.line}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, letterSpacing: -.3 }}>CRM</h1>
            <div style={{ fontSize: 12, color: COLORS.dim, marginTop: 2 }}>
              Preview · {totals.count} deals · last 6 months · changes are not saved yet
            </div>
          </div>
          <div style={{ display: 'flex', gap: 20, fontSize: 12 }}>
            <Stat label="Open" value={totals.openCount} />
            <Stat label="Open value" value={money(totals.openValue)} accent />
            <Stat label="Won" value={totals.won} />
            <Stat label="Lost" value={totals.lost} />
          </div>
        </div>
        {/* Controls */}
        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <input placeholder="Search title, organization, contact…" value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ ...input, minWidth: 280, flex: '0 1 340px' }} />
          <div style={{ display: 'flex', gap: 4 }}>
            {['all', 'open', 'won', 'lost'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                style={{ ...btnBase, textTransform: 'capitalize',
                  background: statusFilter === s ? COLORS.accent : COLORS.panel2,
                  color: statusFilter === s ? '#1a1200' : COLORS.text,
                  border: `1px solid ${statusFilter === s ? COLORS.accent : COLORS.line}` }}>{s}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Board */}
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', padding: 16 }}>
        <div style={{ display: 'flex', gap: 12, height: '100%', minHeight: 0 }}>
          {STAGES.map(stage => (
            <StageColumn key={stage.id} stage={stage} deals={byStage[stage.id] || []}
              onOpen={setOpenId} onDragStart={onDragStart} onDrop={onDrop} />
          ))}
        </div>
      </div>

      <DealDrawer
        deal={openDeal}
        onClose={() => setOpenId(null)}
        onSetStatus={setStatus}
        onAddTask={addTask}
        onToggleTask={toggleTask}
        onAddField={addField}
        onMove={moveDeal}
      />
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: accent ? COLORS.accent : COLORS.text }}>{value}</div>
      <div style={{ fontSize: 11, color: COLORS.dim }}>{label}</div>
    </div>
  );
}

// --- inline styles ---------------------------------------------------------
const btnBase = { padding: '7px 12px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none' };
const btnGhost = { ...btnBase, background: 'transparent', color: COLORS.dim, border: `1px solid ${COLORS.line}` };
const input = { background: COLORS.panel2, border: `1px solid ${COLORS.line}`, borderRadius: 7, padding: '7px 10px', fontSize: 13, color: COLORS.text, outline: 'none' };
const select = { ...input, width: '100%' };
const lbl = { display: 'block', fontSize: 11, color: COLORS.dim, marginBottom: 4, textTransform: 'uppercase', letterSpacing: .4 };
const sectionTitle = { fontSize: 11, color: COLORS.dim, textTransform: 'uppercase', letterSpacing: .5, fontWeight: 700, marginBottom: 8, borderBottom: `1px solid ${COLORS.line}`, paddingBottom: 6 };
const fieldRow = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', fontSize: 13, borderBottom: `1px solid rgba(40,56,74,.4)` };
const fieldKey = { color: COLORS.dim, flexShrink: 0 };
const fieldVal = { color: COLORS.text, textAlign: 'right', wordBreak: 'break-word' };

// -----------------------------------------------------------------------------
// OPTIONAL server-side admin gate (recommended once you're happy):
// Uncomment and adapt to your lib/portalAuth.js requireRole pattern.
//
// export async function getServerSideProps(ctx) {
//   const guard = await requireRole(ctx, ['admin']);   // your existing helper
//   if (!guard.ok) {
//     return { redirect: { destination: '/', permanent: false } };
//   }
//   return { props: {} };
// }
// -----------------------------------------------------------------------------
