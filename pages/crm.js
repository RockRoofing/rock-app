// pages/crm.js
// -----------------------------------------------------------------------------
// CRM PREVIEW  (admin-only once you enable the guard at the bottom)
//
// Styled to match Pipedrive. SELF-CONTAINED PREVIEW: reads deals baked into
// lib/crmSeedDeals.js and keeps every change in the browser's memory only.
// Refreshing resets to the seed. Nothing here touches your live database or
// dashboards.
//
// Board:
//   - 15 stages left-to-right, each header shows £total and deal count
//   - Cards show title, org, contact, date, value, owner initials
//   - Click a card to open the full deal view
//
// Deal view:
//   - Clickable stage timeline bar across the top (click a segment = move stage)
//     Segments are even width, no day-counts (past per-stage history isn't in
//     the export, so we don't invent it). Passed/current = green, ahead = grey.
//   - Left: Summary + Details (all custom fields)
//   - Centre: add a note; add an activity (Call or Email only); Won/Lost
//   - History: one combined chronological "All" view, every event dated
//     (note added, activity completed, stage moved, value changed, close-date
//      changed, won/lost, imported)
// -----------------------------------------------------------------------------

import { useState, useMemo, useRef } from 'react';
import { SEED_DEALS } from '../lib/crmSeedDeals';

const STAGES = [
  { id: 'stage_project_in',   label: 'Project In' },
  { id: 'stage_1st_contact',  label: '1st Contact' },
  { id: 'stage_calls_x3',     label: 'Calls x 3' },
  { id: 'stage_in_abeyance',  label: 'In Abeyance' },
  { id: 'stage_tbf',          label: 'TBF' },
  { id: 'stage_variations',   label: 'Variations' },
  { id: 'stage_info_pending', label: 'info Pending' },
  { id: 'stage_received',     label: 'Received' },
  { id: 'stage_1',            label: 'Stage 1' },
  { id: 'stage_2',            label: 'Stage 2' },
  { id: 'stage_review',       label: 'Review' },
  { id: 'stage_mc_unsec_np',  label: 'MC Unsecured Not Priced' },
  { id: 'stage_mc_unsecured', label: 'MC Unsecured' },
  { id: 'stage_mc_secured',   label: 'MC Secured' },
  { id: 'stage_negotiating',  label: 'Negotiating' },
];
const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.id, i]));
const stageLabel = (id) => (STAGES.find((s) => s.id === id) || {}).label || id;

// Detail fields shown in the left column, in order.
const DETAIL_FIELDS = [
  ['glenigan_id', 'Glenigan Project ID'],
  ['site_location', 'Site Location'],
  ['region', 'Region'],
  ['size_m2', 'Size: m2'],
  ['credit_score', 'Credit Score'],
  ['credit_limit', 'Credit Limit'],
  ['project_stage', 'Project Stage'],
  ['roofing_works_onsite', 'Roofing Works On-Site'],
  ['estimator_responsible', 'Estimator Responsible'],
  ['systems_priced', 'Systems Priced'],
  ['lead_source', 'Lead Source'],
  ['project_type', 'Project Type'],
  ['scope_of_works', 'Description of Project Scope of Works'],
  ['general_info', 'General Information'],
];

// ---- helpers --------------------------------------------------------------
function money(v) {
  const n = Number(v);
  if (isNaN(n)) return '£0';
  return '£' + n.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}
function money0(v) {
  const n = Number(v);
  if (isNaN(n)) return '£0';
  return '£' + n.toLocaleString('en-GB', { maximumFractionDigits: 0 });
}
function shortDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function dateTime(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function initials(name) {
  if (!name) return '?';
  return String(name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}
function nowIso() { return new Date().toISOString(); }
function fieldVal(k, v) {
  if (v === null || v === undefined || v === '') return '-';
  if (k === 'size_m2') { const n = Number(v); if (!isNaN(n)) return n.toLocaleString('en-GB'); }
  if (k === 'credit_limit') { const n = Number(v); if (!isNaN(n)) return money0(n); }
  return String(v);
}

// ---- palette (Pipedrive-ish light theme) ----------------------------------
const C = {
  green: '#2a862f',
  greenBar: '#3a9c3e',
  grey: '#e4e7ea',
  line: '#e1e4e8',
  text: '#1a1a1a',
  dim: '#7a828a',
  link: '#2a7de1',
  bg: '#f4f5f7',
  card: '#ffffff',
  won: '#2a862f',
  lost: '#d64545',
  amber: '#e6a817',
};

// ===========================================================================
// BOARD
// ===========================================================================
function BoardCard({ deal, onOpen }) {
  return (
    <div onClick={() => onOpen(deal.id)} style={{
      background: C.card, border: `1px solid ${C.line}`, borderRadius: 6,
      padding: '9px 10px', marginBottom: 8, cursor: 'pointer', fontSize: 12,
    }}>
      <div style={{ fontWeight: 600, color: C.text, lineHeight: 1.3, marginBottom: 3 }}>{deal.title}</div>
      <div style={{ color: C.dim, marginBottom: 2 }}>{deal.fields.organization || '\u00a0'}</div>
      <div style={{ color: C.dim, marginBottom: 2 }}>{deal.fields.contact_person || '\u00a0'}</div>
      <div style={{ color: C.dim, marginBottom: 6, fontSize: 11 }}>{shortDate(deal.fields.created)}</div>
      <div style={{ fontWeight: 600, color: C.text, marginBottom: 8 }}>{money(deal.fields.value)}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span title={deal.fields.owner || ''} style={{
          width: 22, height: 22, borderRadius: '50%', background: '#cfd6dd',
          color: '#333', fontSize: 10, fontWeight: 700, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}>{initials(deal.fields.owner)}</span>
        {deal.status === 'won' && <span style={pill(C.won)}>Won</span>}
        {deal.status === 'lost' && <span style={pill(C.lost)}>Lost</span>}
        {deal.status === 'open' && Number(deal.fields.value) === 0 &&
          <span title="No value set" style={{ color: C.amber, fontSize: 14 }}>⚠</span>}
      </div>
    </div>
  );
}

function BoardColumn({ stage, deals, onOpen }) {
  const total = deals.reduce((s, d) => s + (Number(d.fields.value) || 0), 0);
  return (
    <div style={{ minWidth: 208, maxWidth: 208, flex: '0 0 208px', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 4px 10px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{stage.label}</div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{money0(total)} · {deals.length} deals</div>
      </div>
      <div style={{ overflowY: 'auto', flex: 1, paddingRight: 4 }}>
        {deals.map((d) => <BoardCard key={d.id} deal={d} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

// ===========================================================================
// STAGE TIMELINE BAR (clickable)
// ===========================================================================
function TimelineBar({ deal, onMove }) {
  const currentIdx = STAGE_INDEX[deal.stageId];
  return (
    <div style={{ display: 'flex', gap: 3, padding: '10px 0' }}>
      {STAGES.map((s, i) => {
        const passed = i <= currentIdx;
        return (
          <div key={s.id} title={s.label} onClick={() => onMove(deal.id, s.id)}
            style={{
              flex: 1, height: 22, cursor: 'pointer', position: 'relative',
              background: passed ? C.greenBar : C.grey,
              clipPath: 'polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%, 9px 50%)',
            }}>
            <span style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 10, fontWeight: 600,
              color: passed ? '#fff' : C.dim, whiteSpace: 'nowrap', overflow: 'hidden',
            }}>{i === currentIdx ? s.label : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// HISTORY (combined chronological)
// ===========================================================================
function historyIcon(type) {
  const map = { note: '📝', call: '📞', email: '✉️', stage: '↗', value: '£', close: '📅', won: '✓', lost: '✕', import: '⬇' };
  return map[type] || '•';
}
function HistoryFeed({ history }) {
  const sorted = [...history].sort((a, b) => new Date(b.ts) - new Date(a.ts));
  return (
    <div>
      {sorted.map((h) => (
        <div key={h.id} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: `1px solid ${C.line}` }}>
          <span style={{
            width: 26, height: 26, borderRadius: '50%', background: '#f0f2f4', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
          }}>{historyIcon(h.type)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: C.text, lineHeight: 1.4 }}>{h.text}</div>
            {h.body && <div style={{ fontSize: 13, color: '#444', marginTop: 3, whiteSpace: 'pre-wrap' }}>{h.body}</div>}
            <div style={{ fontSize: 11, color: C.dim, marginTop: 3 }}>{dateTime(h.ts)}</div>
          </div>
        </div>
      ))}
      {sorted.length === 0 && <div style={{ fontSize: 13, color: C.dim, padding: '16px 0' }}>No history yet.</div>}
    </div>
  );
}

// ===========================================================================
// DEAL VIEW (full screen, replaces board)
// ===========================================================================
function DealView({ deal, onBack, onMove, onSetStatus, onAddNote, onAddActivity, onEditValue, onEditClose }) {
  const [noteText, setNoteText] = useState('');
  const [actType, setActType] = useState('call');
  const [actText, setActText] = useState('');
  const [editingValue, setEditingValue] = useState(false);
  const [valueDraft, setValueDraft] = useState(String(deal.fields.value ?? ''));

  return (
    <div style={{ background: C.card, minHeight: '100vh' }}>
      {/* top bar */}
      <div style={{ borderBottom: `1px solid ${C.line}`, padding: '14px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={onBack} style={backBtn}>← Deals</button>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: C.text }}>{deal.title}</h1>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => onSetStatus(deal.id, 'won')}
              style={{ ...wlBtn, background: deal.status === 'won' ? C.won : '#fff',
                       color: deal.status === 'won' ? '#fff' : C.won, borderColor: C.won }}>Won</button>
            <button onClick={() => onSetStatus(deal.id, 'lost')}
              style={{ ...wlBtn, background: deal.status === 'lost' ? C.lost : '#fff',
                       color: deal.status === 'lost' ? '#fff' : C.lost, borderColor: C.lost }}>Lost</button>
            {deal.status !== 'open' && <button onClick={() => onSetStatus(deal.id, 'open')} style={backBtn}>Reopen</button>}
          </div>
        </div>
        {/* clickable timeline */}
        <TimelineBar deal={deal} onMove={onMove} />
        <div style={{ fontSize: 12, color: C.dim }}>Project → {stageLabel(deal.stageId)}</div>
      </div>

      {/* body: left details + centre history */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
        {/* LEFT COLUMN */}
        <div style={{ width: 300, flexShrink: 0, borderRight: `1px solid ${C.line}`, padding: 20, boxSizing: 'border-box' }}>
          <div style={sideHead}>Summary</div>
          <div style={sideRow}>
            <span style={sideKey}>Value</span>
            {editingValue ? (
              <span style={{ display: 'flex', gap: 4 }}>
                <input value={valueDraft} onChange={(e) => setValueDraft(e.target.value)}
                  style={{ ...miniInput, width: 90 }} />
                <button onClick={() => { onEditValue(deal.id, Number(valueDraft) || 0); setEditingValue(false); }}
                  style={miniBtn}>Save</button>
              </span>
            ) : (
              <span style={sideValLink} onClick={() => { setValueDraft(String(deal.fields.value ?? '')); setEditingValue(true); }}>
                {money(deal.fields.value)}
              </span>
            )}
          </div>
          <div style={sideRow}><span style={sideKey}>Organization</span><span style={sideVal}>{deal.fields.organization || '-'}</span></div>
          <div style={sideRow}><span style={sideKey}>Contact</span><span style={sideVal}>{deal.fields.contact_person || '-'}</span></div>
          <div style={sideRow}><span style={sideKey}>Owner</span><span style={sideVal}>{deal.fields.owner || '-'}</span></div>
          <div style={sideRow}>
            <span style={sideKey}>Expected close</span>
            <span style={sideValLink} onClick={() => {
              const v = prompt('Expected close date (YYYY-MM-DD):', deal.fields.expected_close_date || '');
              if (v !== null) onEditClose(deal.id, v);
            }}>{shortDate(deal.fields.expected_close_date) || '-'}</span>
          </div>

          <div style={{ ...sideHead, marginTop: 20 }}>Details</div>
          {DETAIL_FIELDS.map(([k, lbl]) => (
            <div key={k} style={sideRow}>
              <span style={sideKey}>{lbl}</span>
              <span style={sideVal}>{fieldVal(k, deal.fields[k])}</span>
            </div>
          ))}
        </div>

        {/* CENTRE */}
        <div style={{ flex: 1, padding: 20, minWidth: 0 }}>
          {/* add note */}
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <textarea placeholder="Take a note…" value={noteText} onChange={(e) => setNoteText(e.target.value)}
              rows={2} style={{ ...miniInput, width: '100%', resize: 'vertical', boxSizing: 'border-box', border: 'none', outline: 'none', fontSize: 14 }} />
            <div style={{ textAlign: 'right', marginTop: 6 }}>
              <button disabled={!noteText.trim()} onClick={() => { onAddNote(deal.id, noteText.trim()); setNoteText(''); }}
                style={{ ...primaryBtn, opacity: noteText.trim() ? 1 : 0.5 }}>Add note</button>
            </div>
          </div>

          {/* add activity */}
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: 12, marginBottom: 20 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <select value={actType} onChange={(e) => setActType(e.target.value)} style={{ ...miniInput, width: 110 }}>
                <option value="call">Call</option>
                <option value="email">Email</option>
              </select>
              <input placeholder="Activity detail…" value={actText} onChange={(e) => setActText(e.target.value)}
                style={{ ...miniInput, flex: 1 }} />
              <button disabled={!actText.trim()} onClick={() => { onAddActivity(deal.id, actType, actText.trim()); setActText(''); }}
                style={{ ...primaryBtn, opacity: actText.trim() ? 1 : 0.5 }}>Log {actType}</button>
            </div>
            <div style={{ fontSize: 11, color: C.dim }}>Activity types: call or email only.</div>
          </div>

          {/* history */}
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>History</div>
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 8 }}>All activity, newest first</div>
          <HistoryFeed history={deal.history} />
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// PAGE
// ===========================================================================
export default function CRMPage() {
  const [deals, setDeals] = useState(() =>
    SEED_DEALS.map((d) => ({ ...d, fields: { ...d.fields }, history: [...(d.history || [])] })));
  const [openId, setOpenId] = useState(null);
  const [query, setQuery] = useState('');

  const openDeal = deals.find((d) => d.id === openId) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return deals;
    return deals.filter((d) =>
      (d.title || '').toLowerCase().includes(q) ||
      (d.fields.organization || '').toLowerCase().includes(q) ||
      (d.fields.contact_person || '').toLowerCase().includes(q));
  }, [deals, query]);

  const byStage = useMemo(() => {
    const m = {}; STAGES.forEach((s) => (m[s.id] = []));
    filtered.forEach((d) => { if (m[d.stageId]) m[d.stageId].push(d); });
    return m;
  }, [filtered]);

  const totalCount = deals.length;
  const totalValue = deals.filter((d) => d.status === 'open').reduce((s, d) => s + (Number(d.fields.value) || 0), 0);

  // mutations (each logs history where relevant)
  const push = (id, ev) => setDeals((prev) => prev.map((d) => d.id === id
    ? { ...d, history: [...d.history, { id: `${ev.type}_${Date.now()}`, ts: nowIso(), ...ev }] } : d));

  const moveDeal = (id, stageId) => setDeals((prev) => prev.map((d) => {
    if (d.id !== id || d.stageId === stageId) return d;
    const from = stageLabel(d.stageId), to = stageLabel(stageId);
    return { ...d, stageId, history: [...d.history, { id: `stage_${Date.now()}`, type: 'stage', ts: nowIso(), text: `Stage: ${from} → ${to}` }] };
  }));
  const setStatus = (id, status) => setDeals((prev) => prev.map((d) => {
    if (d.id !== id) return d;
    const label = status === 'won' ? 'Deal marked Won' : status === 'lost' ? 'Deal marked Lost' : 'Deal reopened';
    const type = status === 'won' ? 'won' : status === 'lost' ? 'lost' : 'note';
    return { ...d, status, history: [...d.history, { id: `st_${Date.now()}`, type, ts: nowIso(), text: label }] };
  }));
  const addNote = (id, text) => push(id, { type: 'note', text: 'Note added', body: text });
  const addActivity = (id, kind, text) => push(id, { type: kind, text: `${kind === 'call' ? 'Call' : 'Email'} logged`, body: text });
  const editValue = (id, val) => setDeals((prev) => prev.map((d) => {
    if (d.id !== id) return d;
    const old = money(d.fields.value);
    return { ...d, fields: { ...d.fields, value: val },
             history: [...d.history, { id: `val_${Date.now()}`, type: 'value', ts: nowIso(), text: `Value: ${old} → ${money(val)}` }] };
  }));
  const editClose = (id, val) => setDeals((prev) => prev.map((d) => {
    if (d.id !== id) return d;
    const old = d.fields.expected_close_date || 'empty';
    return { ...d, fields: { ...d.fields, expected_close_date: val || null },
             history: [...d.history, { id: `cl_${Date.now()}`, type: 'close', ts: nowIso(), text: `Expected close date: ${old} → ${val || 'empty'}` }] };
  }));

  // sync openDeal reference after mutations
  const live = deals.find((d) => d.id === openId) || null;

  if (live) {
    return (
      <div style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', color: C.text }}>
        <DealView deal={live} onBack={() => setOpenId(null)} onMove={moveDeal}
          onSetStatus={setStatus} onAddNote={addNote} onAddActivity={addActivity}
          onEditValue={editValue} onEditClose={editClose} />
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text,
                  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
                  display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: C.card, borderBottom: `1px solid ${C.line}`, padding: '12px 20px', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Deals</h1>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>Preview · last 6 months · changes not saved yet</div>
          </div>
          <input placeholder="Search title, organization, contact…" value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ ...miniInput, minWidth: 260, flex: '0 1 320px' }} />
          <div style={{ fontSize: 13, color: C.dim }}>{totalCount} deals · {money0(totalValue)} open</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 10, height: '100%', minHeight: 0 }}>
          {STAGES.map((s) => <BoardColumn key={s.id} stage={s} deals={byStage[s.id] || []} onOpen={setOpenId} />)}
        </div>
      </div>
    </div>
  );
}

// ---- styles ---------------------------------------------------------------
function pill(color) {
  return { fontSize: 10, fontWeight: 700, color: '#fff', background: color, padding: '1px 7px', borderRadius: 3 };
}
const backBtn = { background: '#fff', border: `1px solid ${C.line}`, borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: C.text, fontWeight: 600 };
const wlBtn = { border: '1px solid', borderRadius: 6, padding: '6px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const primaryBtn = { background: C.link, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const miniBtn = { background: C.link, color: '#fff', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const miniInput = { border: `1px solid ${C.line}`, borderRadius: 6, padding: '7px 9px', fontSize: 13, color: C.text, outline: 'none', background: '#fff' };
const sideHead = { fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${C.line}` };
const sideRow = { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', fontSize: 12, alignItems: 'flex-start' };
const sideKey = { color: C.dim, flexShrink: 0, maxWidth: 130 };
const sideVal = { color: C.text, textAlign: 'right', wordBreak: 'break-word' };
const sideValLink = { color: C.link, textAlign: 'right', wordBreak: 'break-word', cursor: 'pointer' };

// -----------------------------------------------------------------------------
// OPTIONAL admin gate — uncomment and wire to your lib/portalAuth.js requireRole:
//
// export async function getServerSideProps(ctx) {
//   const guard = await requireRole(ctx, ['admin']);
//   if (!guard.ok) return { redirect: { destination: '/', permanent: false } };
//   return { props: {} };
// }
// -----------------------------------------------------------------------------
