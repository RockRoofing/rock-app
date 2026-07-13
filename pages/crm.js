// pages/crm.js
// -----------------------------------------------------------------------------
// CRM PREVIEW (admin-only once guard enabled at bottom)
// SELF-CONTAINED: reads baked-in seed data, all changes in browser memory only.
// Refreshing resets everything. Nothing here touches your live DB or dashboards.
//
// Features:
//  - Pipeline View / List View toggle
//  - List view: click column headers to sort; choose visible columns
//  - Saved filters: "Tender Review List", "MC Secured & Negotiated"
//  - Custom filter builder (any field + value)
//  - Stage visibility: show/hide stages on your screen (e.g. Received onwards)
//  - Coloured columns: Project In→info Pending light orange; Received→
//    Negotiating light blue; white gaps between columns; cards stay white
//  - Drag-and-drop on the board AND click-timeline inside a deal to move stage
//  - Single activity per deal with a due date; card dots:
//      no activity = ⚠ warning · overdue = red · due today = green · future = grey
//  - Add new project: all fields + customer/contact type-ahead search
// -----------------------------------------------------------------------------

import { useState, useMemo, useRef } from 'react';
import { SEED_DEALS, PREVIEW_TODAY } from '../lib/crmSeedDeals';
import { ORGS, CONTACTS } from '../lib/crmDirectory';

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

// Column colour bands. orange group first, blue group second.
const ORANGE_STAGES = new Set(['stage_project_in','stage_1st_contact','stage_calls_x3','stage_in_abeyance','stage_tbf','stage_variations','stage_info_pending']);
const BLUE_STAGES = new Set(['stage_received','stage_1','stage_2','stage_review','stage_mc_unsec_np','stage_mc_unsecured','stage_mc_secured','stage_negotiating']);
function columnBg(stageId) {
  if (ORANGE_STAGES.has(stageId)) return '#fdf1e3'; // light orange
  if (BLUE_STAGES.has(stageId)) return '#e8f1fb';    // light blue
  return '#f4f5f7';
}

// All fields that can be shown as list columns / used in filters.
const FIELDS = [
  ['title', 'Title'],
  ['organization', 'Organization'],
  ['contact_person', 'Contact'],
  ['value', 'Value'],
  ['owner', 'Owner'],
  ['estimator_responsible', 'Estimator Responsible'],
  ['stageId', 'Stage'],
  ['status', 'Status'],
  ['region', 'Region'],
  ['project_type', 'Project Type'],
  ['systems_priced', 'Systems Priced'],
  ['lead_source', 'Lead Source'],
  ['site_location', 'Site Location'],
  ['site_postcode', 'Postcode'],
  ['size_m2', 'Size: m2'],
  ['credit_score', 'Credit Score'],
  ['glenigan_id', 'Glenigan ID'],
  ['project_stage', 'Project Stage'],
  ['expected_close_date', 'Expected close'],
  ['created', 'Created'],
];
const DEFAULT_COLUMNS = ['title','organization','contact_person','value','stageId','owner','estimator_responsible','status'];

const DETAIL_FIELDS = [
  ['glenigan_id','Glenigan Project ID'],['site_location','Site Location'],['region','Region'],
  ['size_m2','Size: m2'],['credit_score','Credit Score'],['credit_limit','Credit Limit'],
  ['project_stage','Project Stage'],['roofing_works_onsite','Roofing Works On-Site'],
  ['estimator_responsible','Estimator Responsible'],['systems_priced','Systems Priced'],
  ['lead_source','Lead Source'],['project_type','Project Type'],
  ['scope_of_works','Description of Project Scope of Works'],['general_info','General Information'],
];

// Add-project form fields (subset users actually fill in).
const NEW_PROJECT_FIELDS = [
  ['title','Project title', true],
  ['value','Value (£)', false],
  ['site_location','Site Location', false],
  ['site_postcode','Postcode', false],
  ['region','Region', false],
  ['size_m2','Size: m2', false],
  ['glenigan_id','Glenigan Project ID', false],
  ['estimator_responsible','Estimator Responsible', false],
  ['project_type','Project Type', false],
  ['systems_priced','Systems Priced', false],
  ['lead_source','Lead Source', false],
  ['scope_of_works','Scope of Works', false],
];

// ---- helpers --------------------------------------------------------------
const money = (v) => { const n = Number(v); return isNaN(n) ? '£0' : '£' + n.toLocaleString('en-GB', { maximumFractionDigits: 2 }); };
const money0 = (v) => { const n = Number(v); return isNaN(n) ? '£0' : '£' + n.toLocaleString('en-GB', { maximumFractionDigits: 0 }); };
const shortDate = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
const dateTime = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const initials = (n) => !n ? '?' : String(n).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const nowIso = () => new Date().toISOString();

function activityState(deal, today) {
  if (deal.status !== 'open') return null;
  const a = deal.activity;
  if (!a || a.done) return 'none';
  if (a.due < today) return 'overdue';
  if (a.due === today) return 'today';
  return 'future';
}
function cellValue(deal, key) {
  if (key === 'stageId') return stageLabel(deal.stageId);
  if (key === 'title') return deal.title;
  if (key === 'status') return deal.status;
  const v = deal.fields[key];
  return v === null || v === undefined ? '' : v;
}
function displayCell(deal, key) {
  const v = cellValue(deal, key);
  if (key === 'value') return money(deal.fields.value);
  if (key === 'created' || key === 'expected_close_date') return shortDate(deal.fields[key]);
  if (key === 'size_m2') { const n = Number(v); return isNaN(n) || v === '' ? '-' : n.toLocaleString('en-GB'); }
  if (key === 'status') return v ? v[0].toUpperCase() + v.slice(1) : '-';
  return v === '' ? '-' : String(v);
}

const C = {
  green: '#2a862f', greenBar: '#3a9c3e', grey: '#e4e7ea', line: '#e1e4e8',
  text: '#1a1a1a', dim: '#7a828a', link: '#2a7de1', bg: '#f4f5f7', card: '#ffffff',
  won: '#2a862f', lost: '#d64545', amber: '#e6a817', red: '#d64545', dotGrey: '#9aa3ab',
};

// Saved filters (match Images 1 & 2).
const SAVED_FILTERS = {
  tender: {
    name: 'Tender Review List',
    test: (d) => d.status === 'open' && ['stage_received','stage_1','stage_2','stage_review'].includes(d.stageId),
  },
  mcsn: {
    name: 'MC Secured & Negotiated',
    test: (d) => d.status === 'open'
      && String(d.fields.estimator_responsible || '').toLowerCase().includes('niall')
      && ['stage_mc_secured','stage_negotiating'].includes(d.stageId),
  },
};

// ===========================================================================
// Type-ahead input
// ===========================================================================
function TypeAhead({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const q = (value || '').trim().toLowerCase();
    if (!q) return [];
    return options.filter((o) => o.toLowerCase().includes(q)).slice(0, 8);
  }, [value, options]);
  return (
    <div style={{ position: 'relative' }}>
      <input value={value || ''} placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={{ ...miniInput, width: '100%', boxSizing: 'border-box' }} />
      {open && matches.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30,
          background: '#fff', border: `1px solid ${C.line}`, borderRadius: 6, marginTop: 2,
          boxShadow: '0 4px 12px rgba(0,0,0,.12)', maxHeight: 220, overflowY: 'auto' }}>
          {matches.map((m) => (
            <div key={m} onMouseDown={() => { onChange(m); setOpen(false); }}
              style={{ padding: '7px 10px', fontSize: 13, cursor: 'pointer', borderBottom: `1px solid #f2f3f5` }}>{m}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Add project modal
// ===========================================================================
function AddProjectModal({ onClose, onCreate }) {
  const [f, setF] = useState({});
  const [org, setOrg] = useState('');
  const [contact, setContact] = useState('');
  const [stageId, setStageId] = useState('stage_project_in');
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const create = () => {
    if (!f.title || !f.title.trim()) { alert('Project title is required.'); return; }
    onCreate({ ...f, organization: org, contact_person: contact, stageId });
  };

  return (
    <div style={overlay}>
      <div style={{ ...modal, maxWidth: 640 }}>
        <div style={modalHead}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Add new project</span>
          <button onClick={onClose} style={xBtn}>✕</button>
        </div>
        <div style={{ padding: 20, overflowY: 'auto', maxHeight: '70vh' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={fLbl}>Customer (organization)</label>
              <TypeAhead value={org} onChange={setOrg} options={ORGS} placeholder="Type to search customers…" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={fLbl}>Customer contact</label>
              <TypeAhead value={contact} onChange={setContact} options={CONTACTS} placeholder="Type to search contacts…" />
            </div>
            <div>
              <label style={fLbl}>Stage</label>
              <select value={stageId} onChange={(e) => setStageId(e.target.value)} style={{ ...miniInput, width: '100%', boxSizing: 'border-box' }}>
                {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            {NEW_PROJECT_FIELDS.map(([k, lbl, req]) => (
              <div key={k} style={k === 'scope_of_works' || k === 'title' ? { gridColumn: '1 / -1' } : {}}>
                <label style={fLbl}>{lbl}{req ? ' *' : ''}</label>
                <input value={f[k] || ''} onChange={(e) => set(k, e.target.value)}
                  style={{ ...miniInput, width: '100%', boxSizing: 'border-box' }} />
              </div>
            ))}
          </div>
        </div>
        <div style={modalFoot}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={create} style={primaryBtn}>Create project</button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Board card + column (with drag & drop and activity dot)
// ===========================================================================
function Dot({ state }) {
  if (state === 'none') return <span title="No activity set" style={{ color: C.amber, fontSize: 14, lineHeight: 1 }}>⚠</span>;
  const color = state === 'overdue' ? C.red : state === 'today' ? C.green : C.dotGrey;
  const title = state === 'overdue' ? 'Activity overdue' : state === 'today' ? 'Activity due today' : 'Activity due in future';
  return <span title={title} style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />;
}

function BoardCard({ deal, onOpen, onDragStart, today }) {
  const st = activityState(deal, today);
  return (
    <div draggable onDragStart={(e) => onDragStart(e, deal.id)} onClick={() => onOpen(deal.id)}
      style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 6, padding: '9px 10px', marginBottom: 8, cursor: 'pointer', fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <div style={{ fontWeight: 600, color: C.text, lineHeight: 1.3, marginBottom: 3 }}>{deal.title}</div>
        {st && <div style={{ flexShrink: 0, marginTop: 2 }}><Dot state={st} /></div>}
      </div>
      <div style={{ color: C.dim, marginBottom: 2 }}>{deal.fields.organization || '\u00a0'}</div>
      <div style={{ color: C.dim, marginBottom: 2 }}>{deal.fields.contact_person || '\u00a0'}</div>
      <div style={{ color: C.dim, marginBottom: 6, fontSize: 11 }}>{shortDate(deal.fields.created)}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 600, color: C.text }}>{money(deal.fields.value)}</span>
        <span title={deal.fields.owner || ''} style={{ width: 22, height: 22, borderRadius: '50%', background: '#cfd6dd', color: '#333', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials(deal.fields.owner)}</span>
      </div>
      {deal.status !== 'open' && <div style={{ marginTop: 6 }}><span style={pill(deal.status === 'won' ? C.won : C.lost)}>{deal.status === 'won' ? 'Won' : 'Lost'}</span></div>}
    </div>
  );
}

function BoardColumn({ stage, deals, onOpen, onDragStart, onDrop, today }) {
  const [over, setOver] = useState(false);
  const total = deals.reduce((s, d) => s + (Number(d.fields.value) || 0), 0);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); onDrop(e, stage.id); }}
      style={{ minWidth: 210, maxWidth: 210, flex: '0 0 210px', display: 'flex', flexDirection: 'column', height: '100%',
        background: over ? '#dbe8fb' : columnBg(stage.id), borderRadius: 8, padding: 8, boxSizing: 'border-box' }}>
      <div style={{ padding: '4px 4px 10px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{stage.label}</div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{money0(total)} · {deals.length} deals</div>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {deals.map((d) => <BoardCard key={d.id} deal={d} onOpen={onOpen} onDragStart={onDragStart} today={today} />)}
      </div>
    </div>
  );
}

// ===========================================================================
// Timeline bar (clickable, inside deal)
// ===========================================================================
function TimelineBar({ deal, onMove }) {
  const cur = STAGE_INDEX[deal.stageId];
  return (
    <div style={{ display: 'flex', gap: 3, padding: '10px 0' }}>
      {STAGES.map((s, i) => {
        const passed = i <= cur;
        return (
          <div key={s.id} title={s.label} onClick={() => onMove(deal.id, s.id)}
            style={{ flex: 1, height: 22, cursor: 'pointer', position: 'relative', background: passed ? C.greenBar : C.grey,
              clipPath: 'polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%, 9px 50%)' }}>
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, color: passed ? '#fff' : C.dim, whiteSpace: 'nowrap', overflow: 'hidden' }}>{i === cur ? s.label : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// History feed
// ===========================================================================
function historyIcon(t) { return ({ note: '📝', activity: '📞', stage: '↗', value: '£', close: '📅', won: '✓', lost: '✕', import: '⬇' })[t] || '•'; }
function HistoryFeed({ history }) {
  const sorted = [...history].sort((a, b) => new Date(b.ts) - new Date(a.ts));
  return (
    <div>
      {sorted.map((h) => (
        <div key={h.id} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: `1px solid ${C.line}` }}>
          <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#f0f2f4', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>{historyIcon(h.type)}</span>
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
// Deal view
// ===========================================================================
function DealView({ deal, today, onBack, onMove, onSetStatus, onAddNote, onSetActivity, onCompleteActivity, onEditValue, onEditClose }) {
  const [noteText, setNoteText] = useState('');
  const [actText, setActText] = useState(deal.activity && !deal.activity.done ? deal.activity.text : '');
  const [actDue, setActDue] = useState(deal.activity && !deal.activity.done ? deal.activity.due : '');
  const [editingValue, setEditingValue] = useState(false);
  const [valueDraft, setValueDraft] = useState(String(deal.fields.value ?? ''));
  const st = activityState(deal, today);

  return (
    <div style={{ background: C.card, minHeight: '100vh' }}>
      <div style={{ borderBottom: `1px solid ${C.line}`, padding: '14px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={onBack} style={backBtn}>← Deals</button>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{deal.title}</h1>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => onSetStatus(deal.id, 'won')} style={{ ...wlBtn, background: deal.status === 'won' ? C.won : '#fff', color: deal.status === 'won' ? '#fff' : C.won, borderColor: C.won }}>Won</button>
            <button onClick={() => onSetStatus(deal.id, 'lost')} style={{ ...wlBtn, background: deal.status === 'lost' ? C.lost : '#fff', color: deal.status === 'lost' ? '#fff' : C.lost, borderColor: C.lost }}>Lost</button>
            {deal.status !== 'open' && <button onClick={() => onSetStatus(deal.id, 'open')} style={backBtn}>Reopen</button>}
          </div>
        </div>
        <TimelineBar deal={deal} onMove={onMove} />
        <div style={{ fontSize: 12, color: C.dim }}>Project → {stageLabel(deal.stageId)}</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <div style={{ width: 300, flexShrink: 0, borderRight: `1px solid ${C.line}`, padding: 20, boxSizing: 'border-box' }}>
          <div style={sideHead}>Summary</div>
          <div style={sideRow}>
            <span style={sideKey}>Value</span>
            {editingValue ? (
              <span style={{ display: 'flex', gap: 4 }}>
                <input value={valueDraft} onChange={(e) => setValueDraft(e.target.value)} style={{ ...miniInput, width: 90 }} />
                <button onClick={() => { onEditValue(deal.id, Number(valueDraft) || 0); setEditingValue(false); }} style={miniBtn}>Save</button>
              </span>
            ) : (
              <span style={sideValLink} onClick={() => { setValueDraft(String(deal.fields.value ?? '')); setEditingValue(true); }}>{money(deal.fields.value)}</span>
            )}
          </div>
          <div style={sideRow}><span style={sideKey}>Organization</span><span style={sideVal}>{deal.fields.organization || '-'}</span></div>
          <div style={sideRow}><span style={sideKey}>Contact</span><span style={sideVal}>{deal.fields.contact_person || '-'}</span></div>
          <div style={sideRow}><span style={sideKey}>Owner</span><span style={sideVal}>{deal.fields.owner || '-'}</span></div>
          <div style={sideRow}>
            <span style={sideKey}>Expected close</span>
            <span style={sideValLink} onClick={() => { const v = prompt('Expected close date (YYYY-MM-DD):', deal.fields.expected_close_date || ''); if (v !== null) onEditClose(deal.id, v); }}>{shortDate(deal.fields.expected_close_date) || '-'}</span>
          </div>
          <div style={{ ...sideHead, marginTop: 20 }}>Details</div>
          {DETAIL_FIELDS.map(([k, lbl]) => (
            <div key={k} style={sideRow}><span style={sideKey}>{lbl}</span><span style={sideVal}>{deal.fields[k] === null || deal.fields[k] === undefined || deal.fields[k] === '' ? '-' : String(deal.fields[k])}</span></div>
          ))}
        </div>

        <div style={{ flex: 1, padding: 20, minWidth: 0 }}>
          {/* next activity */}
          <div style={{ border: `1px solid ${st === 'overdue' ? C.red : C.line}`, borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Next activity</span>
              {st && <Dot state={st} />}
              {deal.activity && !deal.activity.done && <span style={{ fontSize: 12, color: C.dim }}>due {shortDate(deal.activity.due)}</span>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input placeholder="What needs doing…" value={actText} onChange={(e) => setActText(e.target.value)} style={{ ...miniInput, flex: 1 }} />
              <input type="date" value={actDue} onChange={(e) => setActDue(e.target.value)} style={{ ...miniInput, width: 150 }} />
              <button disabled={!actText.trim() || !actDue} onClick={() => onSetActivity(deal.id, actText.trim(), actDue)} style={{ ...primaryBtn, opacity: actText.trim() && actDue ? 1 : 0.5 }}>Set activity</button>
            </div>
            {deal.activity && !deal.activity.done && (
              <div style={{ textAlign: 'right', marginTop: 8 }}>
                <button onClick={() => { onCompleteActivity(deal.id); setActText(''); setActDue(''); }} style={ghostBtn}>Mark done</button>
              </div>
            )}
            <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>One activity per deal, with a due date (can be in the future).</div>
          </div>

          {/* note */}
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: 12, marginBottom: 20 }}>
            <textarea placeholder="Take a note…" value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={2} style={{ width: '100%', resize: 'vertical', boxSizing: 'border-box', border: 'none', outline: 'none', fontSize: 14, fontFamily: 'inherit' }} />
            <div style={{ textAlign: 'right', marginTop: 6 }}>
              <button disabled={!noteText.trim()} onClick={() => { onAddNote(deal.id, noteText.trim()); setNoteText(''); }} style={{ ...primaryBtn, opacity: noteText.trim() ? 1 : 0.5 }}>Add note</button>
            </div>
          </div>

          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>History</div>
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 8 }}>All activity, newest first</div>
          <HistoryFeed history={deal.history} />
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// List view
// ===========================================================================
function ListView({ deals, columns, sort, onSort, onOpen, today }) {
  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', background: '#fff', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 28 }}></th>
            {columns.map((k) => {
              const lbl = (FIELDS.find((f) => f[0] === k) || [k, k])[1];
              const active = sort.key === k;
              return (
                <th key={k} onClick={() => onSort(k)} style={{ ...th, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  {lbl}{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => {
            const stt = activityState(d, today);
            return (
              <tr key={d.id} onClick={() => onOpen(d.id)} style={{ cursor: 'pointer', borderBottom: `1px solid ${C.line}` }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f7f9fb')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}>
                <td style={{ ...td, textAlign: 'center' }}>{stt && <Dot state={stt} />}</td>
                {columns.map((k) => <td key={k} style={td}>{displayCell(d, k)}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ===========================================================================
// PAGE
// ===========================================================================
export default function CRMPage() {
  const today = PREVIEW_TODAY;
  const [deals, setDeals] = useState(() => SEED_DEALS.map((d) => ({ ...d, fields: { ...d.fields }, history: [...(d.history || [])], activity: d.activity ? { ...d.activity } : null })));
  const [openId, setOpenId] = useState(null);
  const [view, setView] = useState('pipeline');
  const [query, setQuery] = useState('');
  const [savedFilter, setSavedFilter] = useState(null); // 'tender' | 'mcsn' | null
  const [customFilter, setCustomFilter] = useState({ field: '', value: '' });
  const [showFilterBar, setShowFilterBar] = useState(false);
  const [visibleStages, setVisibleStages] = useState(() => new Set(STAGES.map((s) => s.id)));
  const [showStagePicker, setShowStagePicker] = useState(false);
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [showColPicker, setShowColPicker] = useState(false);
  const [sort, setSort] = useState({ key: 'created', dir: 'desc' });
  const [showAdd, setShowAdd] = useState(false);
  const dragId = useRef(null);
  const nextId = useRef(900000);

  // filtering
  const filtered = useMemo(() => {
    let list = deals;
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((d) => (d.title || '').toLowerCase().includes(q) || (d.fields.organization || '').toLowerCase().includes(q) || (d.fields.contact_person || '').toLowerCase().includes(q));
    if (savedFilter && SAVED_FILTERS[savedFilter]) list = list.filter(SAVED_FILTERS[savedFilter].test);
    if (customFilter.field && customFilter.value.trim()) {
      const cv = customFilter.value.trim().toLowerCase();
      list = list.filter((d) => String(cellValue(d, customFilter.field)).toLowerCase().includes(cv));
    }
    return list;
  }, [deals, query, savedFilter, customFilter]);

  const shownStages = STAGES.filter((s) => visibleStages.has(s.id));

  const byStage = useMemo(() => {
    const m = {}; shownStages.forEach((s) => (m[s.id] = []));
    filtered.forEach((d) => { if (m[d.stageId]) m[d.stageId].push(d); });
    return m;
  }, [filtered, visibleStages]);

  const listRows = useMemo(() => {
    const rows = [...filtered];
    const { key, dir } = sort;
    rows.sort((a, b) => {
      let av = cellValue(a, key), bv = cellValue(b, key);
      if (key === 'value' || key === 'size_m2' || key === 'credit_score') { av = Number(a.fields[key]) || 0; bv = Number(b.fields[key]) || 0; }
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    return rows;
  }, [filtered, sort]);

  const totalValue = filtered.filter((d) => d.status === 'open').reduce((s, d) => s + (Number(d.fields.value) || 0), 0);

  // mutations
  const moveDeal = (id, stageId) => setDeals((prev) => prev.map((d) => {
    if (d.id !== id || d.stageId === stageId) return d;
    return { ...d, stageId, history: [...d.history, { id: `stage_${Date.now()}`, type: 'stage', ts: nowIso(), text: `Stage: ${stageLabel(d.stageId)} → ${stageLabel(stageId)}` }] };
  }));
  const setStatus = (id, status) => setDeals((prev) => prev.map((d) => {
    if (d.id !== id) return d;
    const text = status === 'won' ? 'Deal marked Won' : status === 'lost' ? 'Deal marked Lost' : 'Deal reopened';
    return { ...d, status, history: [...d.history, { id: `st_${Date.now()}`, type: status === 'open' ? 'note' : status, ts: nowIso(), text }] };
  }));
  const addNote = (id, body) => setDeals((prev) => prev.map((d) => d.id === id ? { ...d, history: [...d.history, { id: `note_${Date.now()}`, type: 'note', ts: nowIso(), text: 'Note added', body }] } : d));
  const setActivity = (id, text, due) => setDeals((prev) => prev.map((d) => d.id === id ? { ...d, activity: { text, due, done: false }, history: [...d.history, { id: `act_${Date.now()}`, type: 'activity', ts: nowIso(), text: `Activity set: ${text} (due ${shortDate(due)})` }] } : d));
  const completeActivity = (id) => setDeals((prev) => prev.map((d) => d.id === id && d.activity ? { ...d, activity: { ...d.activity, done: true }, history: [...d.history, { id: `actd_${Date.now()}`, type: 'activity', ts: nowIso(), text: `Activity completed: ${d.activity.text}` }] } : d));
  const editValue = (id, val) => setDeals((prev) => prev.map((d) => d.id === id ? { ...d, fields: { ...d.fields, value: val }, history: [...d.history, { id: `val_${Date.now()}`, type: 'value', ts: nowIso(), text: `Value: ${money(d.fields.value)} → ${money(val)}` }] } : d));
  const editClose = (id, val) => setDeals((prev) => prev.map((d) => d.id === id ? { ...d, fields: { ...d.fields, expected_close_date: val || null }, history: [...d.history, { id: `cl_${Date.now()}`, type: 'close', ts: nowIso(), text: `Expected close date: ${d.fields.expected_close_date || 'empty'} → ${val || 'empty'}` }] } : d));

  const createProject = (data) => {
    const id = nextId.current++;
    const fields = { value: Number(data.value) || 0, organization: data.organization || null, contact_person: data.contact_person || null, owner: null, created: nowIso().slice(0, 10), expected_close_date: null };
    ['site_location','site_postcode','region','size_m2','glenigan_id','estimator_responsible','project_type','systems_priced','lead_source','scope_of_works'].forEach((k) => { fields[k] = data[k] || null; });
    const d = { id, title: data.title, stageId: data.stageId || 'stage_project_in', status: 'open', fields, activity: null,
      history: [{ id: `new_${id}`, type: 'note', ts: nowIso(), text: 'Project created' }] };
    setDeals((prev) => [d, ...prev]);
    setShowAdd(false);
    setOpenId(id);
  };

  const onDragStart = (e, id) => { dragId.current = id; };
  const onDrop = (e, stageId) => { const id = dragId.current; if (id != null) moveDeal(id, stageId); dragId.current = null; };
  const doSort = (key) => setSort((s) => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });

  const live = deals.find((d) => d.id === openId) || null;
  if (live) {
    return (
      <div style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', color: C.text }}>
        <DealView deal={live} today={today} onBack={() => setOpenId(null)} onMove={moveDeal} onSetStatus={setStatus}
          onAddNote={addNote} onSetActivity={setActivity} onCompleteActivity={completeActivity} onEditValue={editValue} onEditClose={editClose} />
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', display: 'flex', flexDirection: 'column' }}>
      {/* header */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.line}`, padding: '10px 16px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0, marginRight: 6 }}>Deals</h1>
          {/* view toggle */}
          <div style={{ display: 'flex', border: `1px solid ${C.line}`, borderRadius: 6, overflow: 'hidden' }}>
            <button onClick={() => setView('pipeline')} style={segBtn(view === 'pipeline')}>Pipeline</button>
            <button onClick={() => setView('list')} style={segBtn(view === 'list')}>List</button>
          </div>

          <button onClick={() => setShowAdd(true)} style={primaryBtn}>+ Add project</button>

          <div style={{ flex: 1 }} />
          <input placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...miniInput, minWidth: 200 }} />
          <span style={{ fontSize: 13, color: C.dim }}>{filtered.length} deals · {money0(totalValue)} open</span>
        </div>

        {/* filter row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: C.dim, marginRight: 2 }}>Filters:</span>
          <button onClick={() => setSavedFilter(savedFilter === 'tender' ? null : 'tender')} style={chip(savedFilter === 'tender')}>Tender Review List</button>
          <button onClick={() => setSavedFilter(savedFilter === 'mcsn' ? null : 'mcsn')} style={chip(savedFilter === 'mcsn')}>MC Secured &amp; Negotiated</button>
          <button onClick={() => setShowFilterBar((v) => !v)} style={chip(showFilterBar)}>Custom filter ▾</button>
          {view === 'pipeline' && <button onClick={() => setShowStagePicker((v) => !v)} style={chip(showStagePicker)}>Stages ▾</button>}
          {view === 'list' && <button onClick={() => setShowColPicker((v) => !v)} style={chip(showColPicker)}>Columns ▾</button>}
          {(savedFilter || (customFilter.field && customFilter.value)) && <button onClick={() => { setSavedFilter(null); setCustomFilter({ field: '', value: '' }); }} style={{ ...chip(false), color: C.link }}>Clear filters</button>}
        </div>

        {/* custom filter builder */}
        {showFilterBar && (
          <div style={panel}>
            <span style={{ fontSize: 12, color: C.dim }}>Where</span>
            <select value={customFilter.field} onChange={(e) => setCustomFilter((f) => ({ ...f, field: e.target.value }))} style={{ ...miniInput, width: 180 }}>
              <option value="">Select field…</option>
              {FIELDS.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
            </select>
            <span style={{ fontSize: 12, color: C.dim }}>contains</span>
            <input placeholder="value" value={customFilter.value} onChange={(e) => setCustomFilter((f) => ({ ...f, value: e.target.value }))} style={{ ...miniInput, width: 180 }} />
          </div>
        )}

        {/* stage visibility picker */}
        {showStagePicker && view === 'pipeline' && (
          <div style={panel}>
            <span style={{ fontSize: 12, color: C.dim }}>Show stages:</span>
            <button onClick={() => setVisibleStages(new Set(STAGES.map((s) => s.id)))} style={miniBtn}>All</button>
            <button onClick={() => setVisibleStages(new Set(['stage_received','stage_1','stage_2','stage_review','stage_mc_unsec_np','stage_mc_unsecured','stage_mc_secured','stage_negotiating']))} style={miniBtn}>Received onwards</button>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {STAGES.map((s) => (
                <label key={s.id} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input type="checkbox" checked={visibleStages.has(s.id)} onChange={() => setVisibleStages((prev) => { const n = new Set(prev); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })} />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* column picker */}
        {showColPicker && view === 'list' && (
          <div style={panel}>
            <span style={{ fontSize: 12, color: C.dim }}>Columns:</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {FIELDS.map(([k, lbl]) => (
                <label key={k} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input type="checkbox" checked={columns.includes(k)} onChange={() => setColumns((prev) => prev.includes(k) ? prev.filter((c) => c !== k) : [...prev, k])} />
                  {lbl}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* body */}
      <div style={{ flex: 1, overflow: 'hidden', padding: view === 'pipeline' ? '12px 12px' : 0 }}>
        {view === 'pipeline' ? (
          <div style={{ display: 'flex', gap: 8, height: '100%', overflowX: 'auto', minHeight: 0 }}>
            {shownStages.map((s) => <BoardColumn key={s.id} stage={s} deals={byStage[s.id] || []} onOpen={setOpenId} onDragStart={onDragStart} onDrop={onDrop} today={today} />)}
          </div>
        ) : (
          <ListView deals={listRows} columns={columns} sort={sort} onSort={doSort} onOpen={setOpenId} today={today} />
        )}
      </div>

      {showAdd && <AddProjectModal onClose={() => setShowAdd(false)} onCreate={createProject} />}
    </div>
  );
}

// ---- styles ---------------------------------------------------------------
const pill = (color) => ({ fontSize: 10, fontWeight: 700, color: '#fff', background: color, padding: '1px 7px', borderRadius: 3 });
const segBtn = (active) => ({ background: active ? C.link : '#fff', color: active ? '#fff' : C.text, border: 'none', padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' });
const chip = (active) => ({ background: active ? '#e5effd' : '#fff', color: active ? C.link : C.text, border: `1px solid ${active ? C.link : C.line}`, borderRadius: 16, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' });
const panel = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10, padding: 10, background: '#f7f9fb', border: `1px solid ${C.line}`, borderRadius: 8 };
const backBtn = { background: '#fff', border: `1px solid ${C.line}`, borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: C.text, fontWeight: 600 };
const wlBtn = { border: '1px solid', borderRadius: 6, padding: '6px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const primaryBtn = { background: C.link, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const ghostBtn = { background: '#fff', color: C.text, border: `1px solid ${C.line}`, borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const miniBtn = { background: C.link, color: '#fff', border: 'none', borderRadius: 5, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const miniInput = { border: `1px solid ${C.line}`, borderRadius: 6, padding: '7px 9px', fontSize: 13, color: C.text, outline: 'none', background: '#fff', fontFamily: 'inherit' };
const sideHead = { fontSize: 13, fontWeight: 700, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${C.line}` };
const sideRow = { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', fontSize: 12, alignItems: 'flex-start' };
const sideKey = { color: C.dim, flexShrink: 0, maxWidth: 130 };
const sideVal = { color: C.text, textAlign: 'right', wordBreak: 'break-word' };
const sideValLink = { color: C.link, textAlign: 'right', wordBreak: 'break-word', cursor: 'pointer' };
const th = { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: C.dim, fontWeight: 700, borderBottom: `2px solid ${C.line}`, background: '#fafbfc', position: 'sticky', top: 0 };
const td = { padding: '9px 12px', color: C.text, whiteSpace: 'nowrap', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' };
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 };
const modal = { background: '#fff', borderRadius: 10, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
const modalHead = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: `1px solid ${C.line}` };
const modalFoot = { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', borderTop: `1px solid ${C.line}` };
const xBtn = { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: C.dim };
const fLbl = { display: 'block', fontSize: 12, color: C.dim, marginBottom: 4, fontWeight: 600 };

// -----------------------------------------------------------------------------
// OPTIONAL admin gate — uncomment and wire to lib/portalAuth.js requireRole:
// export async function getServerSideProps(ctx) {
//   const guard = await requireRole(ctx, ['admin']);
//   if (!guard.ok) return { redirect: { destination: '/', permanent: false } };
//   return { props: {} };
// }
// -----------------------------------------------------------------------------
