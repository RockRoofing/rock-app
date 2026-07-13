// pages/crm.js
// -----------------------------------------------------------------------------
// CRM PREVIEW (admin-only once guard enabled at bottom)
// SELF-CONTAINED: baked-in seed data, all changes in browser memory only.
// Refreshing resets everything. Nothing here touches your live DB or dashboards.
//
// Deep-link: /crm?deal=12345 opens that deal directly (used by @mention emails).
// -----------------------------------------------------------------------------

import { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import { SEED_DEALS, PREVIEW_TODAY } from '../lib/crmSeedDeals';
import { ORGS, CONTACTS } from '../lib/crmDirectory';
import { DEFAULT_FIELD_SCHEMA, MENTION_USERS } from '../lib/crmFieldSchema';

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

const ORANGE_STAGES = new Set(['stage_project_in','stage_1st_contact','stage_calls_x3','stage_in_abeyance','stage_tbf']);
const BLUE_STAGES = new Set(['stage_variations','stage_info_pending','stage_received','stage_1','stage_2','stage_review','stage_mc_unsec_np','stage_mc_unsecured','stage_mc_secured','stage_negotiating']);
const ESTIMATOR_STAGES = ['stage_variations','stage_info_pending','stage_received','stage_1','stage_2','stage_review','stage_mc_unsec_np','stage_mc_unsecured','stage_mc_secured','stage_negotiating'];
function columnBg(stageId) {
  if (ORANGE_STAGES.has(stageId)) return '#fdf1e3';
  if (BLUE_STAGES.has(stageId)) return '#e8f1fb';
  return '#f4f5f7';
}

const LIST_FIELDS = [
  ['title', 'Title'], ['organization', 'Organization'], ['contact_person', 'Contact'],
  ['value', 'Value'], ['owner', 'Owner'], ['estimator_responsible', 'Estimator Responsible'],
  ['stageId', 'Stage'], ['status', 'Status'], ['region', 'Region'], ['project_type', 'Project Type'],
  ['systems_priced', 'Systems Priced'], ['lead_source', 'Lead Source'], ['site_location', 'Site Location'],
  ['site_postcode', 'Postcode'], ['size_m2', 'Size: m2'], ['credit_score', 'Credit Score'],
  ['glenigan_id', 'Glenigan ID'], ['project_stage', 'Project Stage'],
  ['expected_close_date', 'Tender Return date'], ['created', 'Created'],
];
const DEFAULT_COLUMNS = ['title','organization','contact_person','value','stageId','owner','estimator_responsible','status'];

// ---- helpers --------------------------------------------------------------
const money = (v) => { const n = Number(v); return isNaN(n) ? '£0' : '£' + n.toLocaleString('en-GB', { maximumFractionDigits: 2 }); };
const money0 = (v) => { const n = Number(v); return isNaN(n) ? '£0' : '£' + n.toLocaleString('en-GB', { maximumFractionDigits: 0 }); };
const shortDate = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
const dateTime = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const nowIso = () => new Date().toISOString();
const firstName = (n) => n ? String(n).trim().split(/\s+/)[0] : '';
const lastName = (n) => { if (!n) return ''; const p = String(n).trim().split(/\s+/); return p.length > 1 ? p.slice(1).join(' ') : ''; };

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
  greenBar: '#3a9c3e', grey: '#e4e7ea', line: '#e1e4e8', text: '#1a1a1a', dim: '#7a828a',
  link: '#2a7de1', bg: '#f4f5f7', card: '#ffffff', won: '#2a862f', lost: '#d64545',
  amber: '#f5a623', red: '#ff3b30', green: '#25c249', dotGrey: '#9aa3ab',
  nav: '#1c1c1c', note: '#fff7cc', noteBorder: '#f2e08a', activityBg: '#eaf3ff',
  activityBorder: '#c5ddf7', feedBg: '#f6f8fa', mention: '#e5effd',
};

// ===========================================================================
// Confetti
// ===========================================================================
function Confetti({ onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2600); return () => clearTimeout(t); }, [onDone]);
  const pieces = useMemo(() => Array.from({ length: 90 }, (_, i) => ({
    id: i, left: Math.random() * 100, delay: Math.random() * 0.5, dur: 1.8 + Math.random() * 1.2,
    color: ['#2a862f','#2a7de1','#e6a817','#d64545','#7c4dff','#00bcd4'][i % 6], rot: Math.random() * 360, size: 6 + Math.random() * 8,
  })), []);
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 200, overflow: 'hidden' }}>
      <style>{`@keyframes crmfall{0%{transform:translateY(-20px) rotate(0);opacity:1}100%{transform:translateY(105vh) rotate(720deg);opacity:.9}}@keyframes crmpop{0%{transform:scale(.6);opacity:0}100%{transform:scale(1);opacity:1}}`}</style>
      {pieces.map((p) => <div key={p.id} style={{ position: 'absolute', top: -20, left: p.left + '%', width: p.size, height: p.size * 0.6, background: p.color, transform: `rotate(${p.rot}deg)`, animation: `crmfall ${p.dur}s ${p.delay}s ease-in forwards` }} />)}
      <div style={{ position: 'absolute', top: '32%', left: 0, right: 0, textAlign: 'center', fontSize: 42, fontWeight: 800, color: C.won, textShadow: '0 2px 8px rgba(0,0,0,.15)', animation: 'crmpop .4s ease-out' }}>🎉 Deal Won! 🎉</div>
    </div>
  );
}

// ===========================================================================
// Type-ahead (customers/contacts)
// ===========================================================================
function TypeAhead({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => { const q = (value || '').trim().toLowerCase(); if (!q) return []; return options.filter((o) => o.toLowerCase().includes(q)).slice(0, 8); }, [value, options]);
  return (
    <div style={{ position: 'relative' }}>
      <input value={value || ''} placeholder={placeholder} onChange={(e) => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} style={{ ...miniInput, width: '100%', boxSizing: 'border-box' }} />
      {open && matches.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 6, marginTop: 2, boxShadow: '0 4px 12px rgba(0,0,0,.12)', maxHeight: 220, overflowY: 'auto' }}>
          {matches.map((m) => <div key={m} onMouseDown={() => { onChange(m); setOpen(false); }} style={{ padding: '7px 10px', fontSize: 13, cursor: 'pointer', borderBottom: `1px solid #f2f3f5` }}>{m}</div>)}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Mention textarea — type @ to pick a user
// ===========================================================================
function MentionInput({ value, onChange, placeholder, rows, bg }) {
  const [showList, setShowList] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  const matches = MENTION_USERS.filter((u) => u.name.toLowerCase().includes(q.toLowerCase()) || u.username.includes(q.toLowerCase())).slice(0, 6);

  const onInput = (e) => {
    const val = e.target.value; onChange(val);
    const m = /@(\w*)$/.exec(val.slice(0, e.target.selectionStart));
    if (m) { setQ(m[1]); setShowList(true); } else setShowList(false);
  };
  const pick = (u) => {
    const el = ref.current; const pos = el.selectionStart;
    const before = value.slice(0, pos).replace(/@(\w*)$/, `@${u.name} `);
    const after = value.slice(pos);
    onChange(before + after); setShowList(false);
    setTimeout(() => el.focus(), 0);
  };
  return (
    <div style={{ position: 'relative' }}>
      <textarea ref={ref} value={value} onChange={onInput} placeholder={placeholder} rows={rows || 2}
        style={{ width: '100%', resize: 'vertical', boxSizing: 'border-box', border: 'none', outline: 'none', fontSize: 14, fontFamily: 'inherit', background: bg || 'transparent' }} />
      {showList && matches.length > 0 && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, zIndex: 40, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 6, marginBottom: 4, boxShadow: '0 4px 12px rgba(0,0,0,.15)', minWidth: 160 }}>
          {matches.map((u) => <div key={u.username} onMouseDown={() => pick(u)} style={{ padding: '7px 12px', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 22, height: 22, borderRadius: '50%', background: C.mention, color: C.link, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{u.name[0]}</span>{u.name}</div>)}
        </div>
      )}
    </div>
  );
}
function extractMentions(text) {
  const names = MENTION_USERS.map((u) => u.name);
  return names.filter((n) => new RegExp(`@${n}\\b`, 'i').test(text || ''));
}

// ===========================================================================
// Dots (bigger + brighter)
// ===========================================================================
function Dot({ state, size = 14 }) {
  if (state === 'none') return <span title="No activity set" style={{ color: C.amber, fontSize: size + 6, lineHeight: 1 }}>⚠</span>;
  const color = state === 'overdue' ? C.red : state === 'today' ? C.green : C.dotGrey;
  const title = state === 'overdue' ? 'Activity overdue' : state === 'today' ? 'Activity due today' : 'Activity due in future';
  const glow = state === 'overdue' || state === 'today' ? `0 0 6px ${color}` : 'none';
  return <span title={title} style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'inline-block', boxShadow: glow }} />;
}

// ===========================================================================
// Board card (no initials) + column (drag anywhere, full-height colour)
// ===========================================================================
function BoardCard({ deal, onOpen, onDragStart, today }) {
  const st = activityState(deal, today);
  return (
    <div draggable onDragStart={(e) => onDragStart(e, deal.id)} onClick={() => onOpen(deal.id)} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 6, padding: '9px 10px', marginBottom: 8, cursor: 'pointer', fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <div style={{ fontWeight: 600, color: C.text, lineHeight: 1.3, marginBottom: 3 }}>{deal.title}</div>
        {st && <div style={{ flexShrink: 0, marginTop: 1 }}><Dot state={st} size={14} /></div>}
      </div>
      <div style={{ color: C.dim, marginBottom: 2 }}>{deal.fields.organization || '\u00a0'}</div>
      <div style={{ color: C.dim, marginBottom: 2 }}>{deal.fields.contact_person || '\u00a0'}</div>
      <div style={{ color: C.dim, marginBottom: 6, fontSize: 11 }}>{shortDate(deal.fields.created)}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 600, color: C.text }}>{money(deal.fields.value)}</span>
        {deal.status !== 'open' && <span style={pill(deal.status === 'won' ? C.won : C.lost)}>{deal.status === 'won' ? 'Won' : 'Lost'}</span>}
      </div>
    </div>
  );
}
function BoardColumn({ stage, deals, onOpen, onDragStart, onDrop, today }) {
  const [over, setOver] = useState(false);
  const total = deals.reduce((s, d) => s + (Number(d.fields.value) || 0), 0);
  return (
    // column fills full height; the droppable body stretches so you can drop anywhere below the header
    <div style={{ minWidth: 210, maxWidth: 210, flex: '0 0 210px', display: 'flex', flexDirection: 'column', height: '100%', background: over ? '#dbe8fb' : columnBg(stage.id), borderRadius: 8, padding: 8, boxSizing: 'border-box' }}>
      <div style={{ padding: '4px 4px 10px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{stage.label}</div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{money0(total)} · {deals.length} deals</div>
      </div>
      <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { setOver(false); onDrop(e, stage.id); }}
        style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {deals.map((d) => <BoardCard key={d.id} deal={d} onOpen={onOpen} onDragStart={onDragStart} today={today} />)}
        {/* invisible filler makes the whole remaining area a drop target */}
        <div style={{ minHeight: 120 }} />
      </div>
    </div>
  );
}

// ===========================================================================
// Timeline bar
// ===========================================================================
function TimelineBar({ deal, onMove }) {
  const cur = STAGE_INDEX[deal.stageId];
  return (
    <div style={{ display: 'flex', gap: 3, padding: '10px 0' }}>
      {STAGES.map((s, i) => {
        const passed = i <= cur;
        return (
          <div key={s.id} title={s.label} onClick={() => onMove(deal.id, s.id)} style={{ flex: 1, height: 22, cursor: 'pointer', position: 'relative', background: passed ? C.greenBar : C.grey, clipPath: 'polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%, 9px 50%)' }}>
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, color: passed ? '#fff' : C.dim, whiteSpace: 'nowrap', overflow: 'hidden' }}>{i === cur ? s.label : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// Editable sidebar field
// ===========================================================================
function EditableField({ field, value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => { setDraft(value ?? ''); }, [value]);

  const display = () => {
    if (value === null || value === undefined || value === '') return '-';
    if (field.type === 'currency') return money(value);
    if (field.type === 'number') return Number(value).toLocaleString('en-GB');
    if (field.type === 'date') return shortDate(value);
    if (field.type === 'yesno') return value ? 'Yes' : 'No';
    return String(value);
  };
  const save = () => { onSave(field.key, field.type === 'yesno' ? (draft === 'Yes' || draft === true) : draft); setEditing(false); };

  if (!editing) {
    return <span style={sideValLink} onClick={() => setEditing(true)}>
      {field.type === 'select' && value ? <span style={tag}>{value}</span> : display()}
    </span>;
  }
  const commonProps = { autoFocus: true, value: draft, onChange: (e) => setDraft(e.target.value), style: { ...miniInput, width: '100%', boxSizing: 'border-box' } };
  return (
    <span style={{ display: 'flex', gap: 4, flexDirection: 'column', width: '100%' }}>
      {(field.type === 'text' || field.type === 'number' || field.type === 'currency') && <input type={field.type === 'text' ? 'text' : 'number'} {...commonProps} />}
      {field.type === 'date' && <input type="date" {...commonProps} />}
      {field.type === 'yesno' && <select {...commonProps}><option>Yes</option><option>No</option></select>}
      {field.type === 'select' && <select {...commonProps}><option value="">-</option>{(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}</select>}
      {field.type === 'multiselect' && (
        <select multiple value={String(draft || '').split(', ').filter(Boolean)} onChange={(e) => setDraft(Array.from(e.target.selectedOptions).map((o) => o.value).join(', '))} style={{ ...miniInput, width: '100%', boxSizing: 'border-box', height: 90 }}>
          {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
      <span style={{ display: 'flex', gap: 4 }}><button onClick={save} style={miniBtn}>Save</button><button onClick={() => setEditing(false)} style={ghostBtn}>Cancel</button></span>
    </span>
  );
}

// ===========================================================================
// Field manager modal (add/remove/edit custom fields)
// ===========================================================================
function FieldManager({ schema, onClose, onAdd, onRemove }) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState('text');
  const [group, setGroup] = useState('details');
  const [opts, setOpts] = useState('');
  const add = () => {
    if (!label.trim()) { alert('Field name required'); return; }
    const key = 'custom_' + label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
    onAdd({ key, label: label.trim(), type, group, options: (type === 'select' || type === 'multiselect') ? opts.split(',').map((o) => o.trim()).filter(Boolean) : undefined });
    setLabel(''); setOpts('');
  };
  return (
    <div style={overlay}>
      <div style={{ ...modal, maxWidth: 560 }}>
        <div style={modalHead}><span style={{ fontSize: 16, fontWeight: 700 }}>Customise fields</span><button onClick={onClose} style={xBtn}>✕</button></div>
        <div style={{ padding: 20, overflowY: 'auto', maxHeight: '70vh' }}>
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 8, fontWeight: 700 }}>Add a field</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <input placeholder="Field name" value={label} onChange={(e) => setLabel(e.target.value)} style={miniInput} />
            <select value={group} onChange={(e) => setGroup(e.target.value)} style={miniInput}>
              <option value="summary">Summary</option><option value="details">Details</option><option value="person">Person</option><option value="organization">Organization</option>
            </select>
            <select value={type} onChange={(e) => setType(e.target.value)} style={miniInput}>
              <option value="text">Text</option><option value="number">Number</option><option value="currency">Currency</option><option value="date">Date</option><option value="select">Dropdown</option><option value="multiselect">Multi-select</option><option value="yesno">Yes/No</option>
            </select>
            {(type === 'select' || type === 'multiselect') && <input placeholder="Options, comma-separated" value={opts} onChange={(e) => setOpts(e.target.value)} style={miniInput} />}
          </div>
          <button onClick={add} style={primaryBtn}>Add field</button>

          <div style={{ fontSize: 12, color: C.dim, margin: '18px 0 8px', fontWeight: 700 }}>Current fields</div>
          {['summary','details','person','organization'].map((g) => (
            <div key={g} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', color: C.dim, fontWeight: 700, marginBottom: 4 }}>{g}</div>
              {schema.filter((f) => f.group === g).map((f) => (
                <div key={f.key + f.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', fontSize: 13, borderBottom: `1px solid ${C.line}` }}>
                  <span>{f.label} <span style={{ color: C.dim, fontSize: 11 }}>({f.type}{f.options ? `: ${f.options.length} opts` : ''})</span></span>
                  {f.key.startsWith('custom_') && <button onClick={() => onRemove(f.key)} style={{ ...ghostBtn, padding: '3px 8px', color: C.lost }}>Remove</button>}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={modalFoot}><button onClick={onClose} style={primaryBtn}>Done</button></div>
      </div>
    </div>
  );
}

// ===========================================================================
// Set-activity popout (used after mark-done, and for editing)
// ===========================================================================
function ActivityModal({ initialText, initialDue, onClose, onSave }) {
  const [text, setText] = useState(initialText || '');
  const [due, setDue] = useState(initialDue || '');
  return (
    <div style={overlay}>
      <div style={{ ...modal, maxWidth: 460 }}>
        <div style={modalHead}><span style={{ fontSize: 16, fontWeight: 700 }}>Set next activity</span><button onClick={onClose} style={xBtn}>✕</button></div>
        <div style={{ padding: 20 }}>
          <label style={fLbl}>What needs doing? (type @ to notify someone)</label>
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 6, padding: 8, marginBottom: 10 }}>
            <MentionInput value={text} onChange={setText} placeholder="e.g. Call @Roman to confirm pricing" rows={2} />
          </div>
          <label style={fLbl}>Due date</label>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ ...miniInput, width: '100%', boxSizing: 'border-box' }} />
        </div>
        <div style={modalFoot}><button onClick={onClose} style={ghostBtn}>Cancel</button><button disabled={!text.trim() || !due} onClick={() => onSave(text.trim(), due)} style={{ ...primaryBtn, opacity: text.trim() && due ? 1 : 0.5 }}>Set activity</button></div>
      </div>
    </div>
  );
}

// ===========================================================================
// History feed (editable notes & activities)
// ===========================================================================
function historyIcon(t) { return ({ note: '📝', activity: '📞', stage: '↗', value: '£', close: '📅', won: '✓', lost: '✕', import: '⬇', mention: '@' })[t] || '•'; }
function HistoryFeed({ history, onEdit }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState('');
  const sorted = [...history].sort((a, b) => new Date(b.ts) - new Date(a.ts));
  const editable = (h) => h.type === 'note' || h.type === 'activity';
  return (
    <div>
      {sorted.map((h) => (
        <div key={h.id} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: `1px solid ${C.line}` }}>
          <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#fff', border: `1px solid ${C.line}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>{historyIcon(h.type)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: C.text, lineHeight: 1.4 }}>{h.text}</div>
            {editingId === h.id ? (
              <div style={{ marginTop: 4 }}>
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, border: `1px solid ${C.line}`, borderRadius: 6, padding: 6, fontFamily: 'inherit' }} />
                <div style={{ marginTop: 4, display: 'flex', gap: 6 }}><button onClick={() => { onEdit(h.id, draft); setEditingId(null); }} style={miniBtn}>Save</button><button onClick={() => setEditingId(null)} style={ghostBtn}>Cancel</button></div>
              </div>
            ) : (h.body && <div style={{ fontSize: 13, color: '#444', marginTop: 3, whiteSpace: 'pre-wrap' }}>{h.body}</div>)}
            <div style={{ fontSize: 11, color: C.dim, marginTop: 3, display: 'flex', gap: 10, alignItems: 'center' }}>
              <span>{dateTime(h.ts)}{h.edited ? ' · edited' : ''}</span>
              {editable(h) && editingId !== h.id && <span onClick={() => { setEditingId(h.id); setDraft(h.body || ''); }} style={{ color: C.link, cursor: 'pointer' }}>Edit</span>}
            </div>
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
function DealView({ deal, today, schema, onBack, onMove, onSetStatus, onAddNote, onEditHistory, onSetActivity, onCompleteActivity, onEditField, onManageFields }) {
  const [noteText, setNoteText] = useState('');
  const [showActivityModal, setShowActivityModal] = useState(false);
  const st = activityState(deal, today);
  const groupFields = (g) => schema.filter((f) => f.group === g);

  return (
    <div style={{ background: C.card, minHeight: '100vh' }}>
      {showActivityModal && <ActivityModal initialText="" initialDue="" onClose={() => setShowActivityModal(false)} onSave={(t, d) => { onSetActivity(deal.id, t, d); setShowActivityModal(false); }} />}
      {/* black nav */}
      <div style={{ background: C.nav, color: '#fff', padding: '10px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onBack} style={{ ...backBtn, background: 'transparent', color: '#fff', borderColor: '#444' }}>← Deals</button>
          <span style={{ fontSize: 17, fontWeight: 700 }}>{deal.title}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => onSetStatus(deal.id, 'won')} style={{ ...wlBtn, background: C.won, color: '#fff' }}>Won</button>
          <button onClick={() => onSetStatus(deal.id, 'lost')} style={{ ...wlBtn, background: C.lost, color: '#fff' }}>Lost</button>
          {deal.status !== 'open' && <button onClick={() => onSetStatus(deal.id, 'open')} style={{ ...backBtn, background: 'transparent', color: '#fff', borderColor: '#444' }}>Reopen</button>}
        </div>
      </div>

      <div style={{ borderBottom: `1px solid ${C.line}`, padding: '10px 24px' }}>
        <TimelineBar deal={deal} onMove={onMove} />
        <div style={{ fontSize: 12, color: C.dim }}>Project → {stageLabel(deal.stageId)}{deal.status !== 'open' && <span style={{ marginLeft: 8 }}><span style={pill(deal.status === 'won' ? C.won : C.lost)}>{deal.status === 'won' ? 'Won' : 'Lost'}</span></span>}</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        {/* LEFT — editable */}
        <div style={{ width: 320, flexShrink: 0, borderRight: `1px solid ${C.line}`, padding: 20, boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Summary</span>
            <button onClick={onManageFields} style={{ ...ghostBtn, padding: '3px 8px', fontSize: 11 }}>⚙ Fields</button>
          </div>
          {groupFields('summary').map((f) => (
            <div key={f.key + f.label} style={sideRow}><span style={sideKey}>{f.label}</span><EditableField field={f} value={deal.fields[f.key]} onSave={(k, v) => onEditField(deal.id, k, v)} /></div>
          ))}

          <div style={{ ...sideHead, marginTop: 20 }}>Details</div>
          {groupFields('details').map((f) => (
            <div key={f.key + f.label} style={sideRow}><span style={sideKey}>{f.label}</span><EditableField field={f} value={deal.fields[f.key]} onSave={(k, v) => onEditField(deal.id, k, v)} /></div>
          ))}

          <div style={{ ...sideHead, marginTop: 20 }}>Person</div>
          <div style={sideRow}><span style={sideKey}>Name</span><EditableField field={{ key: 'contact_person', type: 'text' }} value={deal.fields.contact_person} onSave={(k, v) => onEditField(deal.id, k, v)} /></div>
          <div style={sideRow}><span style={sideKey}>First name</span><span style={sideVal}>{firstName(deal.fields.contact_person) || '-'}</span></div>
          <div style={sideRow}><span style={sideKey}>Last name</span><span style={sideVal}>{lastName(deal.fields.contact_person) || '-'}</span></div>
          {groupFields('person').filter((f) => f.key !== 'contact_person').map((f) => (
            <div key={f.key + f.label} style={sideRow}><span style={sideKey}>{f.label}</span><EditableField field={f} value={deal.fields[f.key]} onSave={(k, v) => onEditField(deal.id, k, v)} /></div>
          ))}

          <div style={{ ...sideHead, marginTop: 20 }}>Organization</div>
          <div style={sideRow}><span style={sideKey}>Company name</span><EditableField field={{ key: 'organization', type: 'text' }} value={deal.fields.organization} onSave={(k, v) => onEditField(deal.id, k, v)} /></div>
          {groupFields('organization').map((f) => (
            <div key={f.key + f.label} style={sideRow}><span style={sideKey}>{f.label}</span><EditableField field={f} value={deal.fields[f.key]} onSave={(k, v) => onEditField(deal.id, k, v)} /></div>
          ))}
        </div>

        {/* CENTRE */}
        <div style={{ flex: 1, padding: 20, minWidth: 0, background: C.feedBg }}>
          {/* Activities to do — always above history, overdue just flags */}
          <div style={{ background: C.activityBg, border: `1px solid ${st === 'overdue' ? C.red : C.activityBorder}`, borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Activities to do</span>
              {st && <Dot state={st} size={13} />}
              {st === 'overdue' && <span style={{ fontSize: 11, fontWeight: 700, color: C.red }}>OVERDUE</span>}
            </div>
            {deal.activity && !deal.activity.done ? (
              <div>
                <div style={{ fontSize: 14, marginBottom: 6 }}>{deal.activity.text}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: C.dim }}>Due</span>
                  <input type="date" value={deal.activity.due} onChange={(e) => onSetActivity(deal.id, deal.activity.text, e.target.value, true)} style={{ ...miniInput, width: 150 }} />
                  <button onClick={() => onCompleteActivity(deal.id)} style={primaryBtn}>Mark done</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowActivityModal(true)} style={primaryBtn}>+ Set activity</button>
            )}
            <div style={{ fontSize: 11, color: C.dim, marginTop: 8 }}>One activity per deal. Due date editable. Marking done prompts you to set the next one.</div>
          </div>

          {/* Note — post-it, with @mentions */}
          <div style={{ background: C.note, border: `1px solid ${C.noteBorder}`, borderRadius: 8, padding: 12, marginBottom: 20 }}>
            <MentionInput value={noteText} onChange={setNoteText} placeholder="Take a note… (type @ to notify someone)" rows={2} bg="transparent" />
            <div style={{ textAlign: 'right', marginTop: 6 }}><button disabled={!noteText.trim()} onClick={() => { onAddNote(deal.id, noteText.trim()); setNoteText(''); }} style={{ ...primaryBtn, opacity: noteText.trim() ? 1 : 0.5 }}>Add note</button></div>
          </div>

          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>History</div>
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 8 }}>All activity, newest first · notes and activities are editable</div>
          <HistoryFeed history={deal.history} onEdit={(hid, body) => onEditHistory(deal.id, hid, body)} />
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
            {columns.map((k) => { const lbl = (LIST_FIELDS.find((f) => f[0] === k) || [k, k])[1]; const active = sort.key === k; return <th key={k} onClick={() => onSort(k)} style={{ ...th, cursor: 'pointer', whiteSpace: 'nowrap' }}>{lbl}{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>; })}
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => { const stt = activityState(d, today); return (
            <tr key={d.id} onClick={() => onOpen(d.id)} style={{ cursor: 'pointer', borderBottom: `1px solid ${C.line}` }} onMouseEnter={(e) => (e.currentTarget.style.background = '#f7f9fb')} onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}>
              <td style={{ ...td, textAlign: 'center' }}>{stt && <Dot state={stt} size={13} />}</td>
              {columns.map((k) => <td key={k} style={td}>{displayCell(d, k)}</td>)}
            </tr>
          ); })}
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
  const router = useRouter();
  const [deals, setDeals] = useState(() => SEED_DEALS.map((d) => ({ ...d, fields: { ...d.fields }, history: [...(d.history || [])], activity: d.activity ? { ...d.activity } : null })));
  const [openId, setOpenId] = useState(null);
  const [view, setView] = useState('pipeline');
  const [query, setQuery] = useState('');
  const [showSuggest, setShowSuggest] = useState(false);
  const [statusFilter, setStatusFilter] = useState('open');
  const [savedFilter, setSavedFilter] = useState(null);
  const [mcsnEstimator, setMcsnEstimator] = useState('all');
  const [customFilters, setCustomFilters] = useState([]);
  const [visibleStages, setVisibleStages] = useState(() => new Set(STAGES.map((s) => s.id)));
  const [stageMode, setStageMode] = useState('all'); // all | estimator
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [showColPicker, setShowColPicker] = useState(false);
  const [sort, setSort] = useState({ key: 'created', dir: 'desc' });
  const [showAdd, setShowAdd] = useState(false);
  const [confetti, setConfetti] = useState(false);
  const [schema, setSchema] = useState(DEFAULT_FIELD_SCHEMA);
  const [showFieldMgr, setShowFieldMgr] = useState(false);
  const dragId = useRef(null);
  const nextId = useRef(900000);

  // deep link: open deal from ?deal=
  useEffect(() => {
    if (!router.isReady) return;
    const q = router.query.deal;
    if (q) setOpenId(Number(q)); 
  }, [router.isReady, router.query.deal]);

  const openDealById = (id) => { setOpenId(id); router.push({ pathname: '/crm', query: { deal: id } }, undefined, { shallow: true }); };
  const closeDeal = () => { setOpenId(null); router.push('/crm', undefined, { shallow: true }); };

  // stage mode toggle
  useEffect(() => { setVisibleStages(new Set(stageMode === 'estimator' ? ESTIMATOR_STAGES : STAGES.map((s) => s.id))); }, [stageMode]);

  const statusOK = (d) => statusFilter === 'all' ? true : d.status === statusFilter;
  const savedOK = (d) => {
    if (savedFilter === 'tender') return ['stage_received','stage_1','stage_2','stage_review'].includes(d.stageId);
    if (savedFilter === 'mcsn') return ['stage_mc_secured','stage_negotiating'].includes(d.stageId);
    return true;
  };

  const filtered = useMemo(() => {
    let list = deals.filter(statusOK).filter(savedOK);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((d) => (d.title || '').toLowerCase().includes(q) || (d.fields.organization || '').toLowerCase().includes(q) || (d.fields.contact_person || '').toLowerCase().includes(q));
    customFilters.forEach((cf) => { if (cf.field && cf.value.trim()) { const cv = cf.value.trim().toLowerCase(); list = list.filter((d) => String(cellValue(d, cf.field)).toLowerCase().includes(cv)); } });
    return list;
  }, [deals, statusFilter, savedFilter, query, customFilters]);

  const mcsnEstimators = useMemo(() => { if (savedFilter !== 'mcsn') return []; const set = new Set(); filtered.forEach((d) => { const e = d.fields.estimator_responsible; if (e && String(e).trim()) set.add(String(e).trim()); }); return Array.from(set).sort(); }, [savedFilter, filtered]);

  const finalList = useMemo(() => {
    if (savedFilter === 'mcsn' && mcsnEstimator !== 'all') return filtered.filter((d) => String(d.fields.estimator_responsible || '') === mcsnEstimator);
    return filtered;
  }, [filtered, savedFilter, mcsnEstimator]);

  // search suggestions (companies + projects)
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase(); if (!q) return [];
    const projMatches = deals.filter((d) => (d.title || '').toLowerCase().includes(q)).slice(0, 5).map((d) => ({ type: 'Project', label: d.title, id: d.id }));
    const orgSet = new Set(); deals.forEach((d) => { const o = d.fields.organization; if (o && o.toLowerCase().includes(q)) orgSet.add(o); });
    const orgMatches = Array.from(orgSet).slice(0, 5).map((o) => ({ type: 'Company', label: o }));
    return [...projMatches, ...orgMatches].slice(0, 8);
  }, [query, deals]);

  const shownStages = STAGES.filter((s) => visibleStages.has(s.id));
  const byStage = useMemo(() => { const m = {}; shownStages.forEach((s) => (m[s.id] = [])); finalList.forEach((d) => { if (m[d.stageId]) m[d.stageId].push(d); }); return m; }, [finalList, visibleStages]);

  const listRows = useMemo(() => {
    const rows = [...finalList];
    // Tender Review List default sort: by Estimator Responsible, blanks at top
    if (savedFilter === 'tender' && sort.key === 'created') {
      rows.sort((a, b) => {
        const ea = (a.fields.estimator_responsible || '').trim(), eb = (b.fields.estimator_responsible || '').trim();
        if (!ea && eb) return -1; if (ea && !eb) return 1;
        return ea.localeCompare(eb);
      });
      return rows;
    }
    const { key, dir } = sort;
    rows.sort((a, b) => { let av = cellValue(a, key), bv = cellValue(b, key); if (key === 'value' || key === 'size_m2' || key === 'credit_score') { av = Number(a.fields[key]) || 0; bv = Number(b.fields[key]) || 0; } if (av < bv) return dir === 'asc' ? -1 : 1; if (av > bv) return dir === 'asc' ? 1 : -1; return 0; });
    return rows;
  }, [finalList, sort, savedFilter]);

  const totalValue = finalList.filter((d) => d.status === 'open').reduce((s, d) => s + (Number(d.fields.value) || 0), 0);

  // mutations
  const moveDeal = (id, stageId) => setDeals((prev) => prev.map((d) => d.id !== id || d.stageId === stageId ? d : { ...d, stageId, history: [...d.history, { id: `stage_${Date.now()}`, type: 'stage', ts: nowIso(), text: `Stage: ${stageLabel(d.stageId)} → ${stageLabel(stageId)}` }] }));
  const setStatus = (id, status) => { setDeals((prev) => prev.map((d) => { if (d.id !== id) return d; const text = status === 'won' ? 'Deal marked Won' : status === 'lost' ? 'Deal marked Lost' : 'Deal reopened'; return { ...d, status, history: [...d.history, { id: `st_${Date.now()}`, type: status === 'open' ? 'note' : status, ts: nowIso(), text }] }; })); if (status === 'won') setConfetti(true); };
  const addNote = (id, body) => {
    const mentions = extractMentions(body);
    setDeals((prev) => prev.map((d) => {
      if (d.id !== id) return d;
      const events = [{ id: `note_${Date.now()}`, type: 'note', ts: nowIso(), text: 'Note added', body }];
      if (mentions.length) events.push({ id: `mn_${Date.now()}`, type: 'mention', ts: nowIso(), text: `Notified: ${mentions.join(', ')} (email would send in live version)` });
      return { ...d, history: [...d.history, ...events] };
    }));
  };
  const editHistory = (id, hid, body) => setDeals((prev) => prev.map((d) => d.id === id ? { ...d, history: d.history.map((h) => h.id === hid ? { ...h, body, edited: true } : h) } : d));
  const setActivity = (id, text, due, silent) => {
    const mentions = extractMentions(text);
    setDeals((prev) => prev.map((d) => {
      if (d.id !== id) return d;
      const events = silent ? [] : [{ id: `act_${Date.now()}`, type: 'activity', ts: nowIso(), text: `Activity set: ${text} (due ${shortDate(due)})`, body: text }];
      if (!silent && mentions.length) events.push({ id: `mn_${Date.now()}`, type: 'mention', ts: nowIso(), text: `Notified: ${mentions.join(', ')} (email would send in live version)` });
      return { ...d, activity: { text, due, done: false }, history: [...d.history, ...events] };
    }));
  };
  const completeActivity = (id) => setDeals((prev) => prev.map((d) => d.id === id && d.activity ? { ...d, activity: { ...d.activity, done: true }, history: [...d.history, { id: `actd_${Date.now()}`, type: 'activity', ts: nowIso(), text: `Activity completed: ${d.activity.text}`, body: d.activity.text }] } : d));
  const editField = (id, key, val) => setDeals((prev) => prev.map((d) => {
    if (d.id !== id) return d;
    const old = d.fields[key];
    const hist = (key === 'value') ? [{ id: `val_${Date.now()}`, type: 'value', ts: nowIso(), text: `Value: ${money(old)} → ${money(val)}` }]
      : (key === 'expected_close_date') ? [{ id: `cl_${Date.now()}`, type: 'close', ts: nowIso(), text: `Tender Return date: ${shortDate(old) || 'empty'} → ${shortDate(val) || 'empty'}` }]
      : [];
    return { ...d, fields: { ...d.fields, [key]: val }, history: [...d.history, ...hist] };
  }));

  const createProject = (data) => {
    const id = nextId.current++;
    const fields = { value: Number(data.value) || 0, organization: data.organization || null, contact_person: data.contact_person || null, owner: null, created: nowIso().slice(0, 10), expected_close_date: null, project_score: null };
    ['site_location','site_postcode','region','size_m2','glenigan_id','estimator_responsible','project_type','systems_priced','lead_source','scope_of_works'].forEach((k) => { fields[k] = data[k] || null; });
    const d = { id, title: data.title, stageId: data.stageId || 'stage_project_in', status: 'open', fields, activity: null, history: [{ id: `new_${id}`, type: 'note', ts: nowIso(), text: 'Project created' }] };
    setDeals((prev) => [d, ...prev]); setShowAdd(false); openDealById(id);
  };

  const addField = (f) => setSchema((prev) => [...prev, f]);
  const removeField = (key) => setSchema((prev) => prev.filter((f) => f.key !== key));

  const onDragStart = (e, id) => { dragId.current = id; };
  const onDrop = (e, stageId) => { const id = dragId.current; if (id != null) moveDeal(id, stageId); dragId.current = null; };
  const doSort = (key) => setSort((s) => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });

  const addCustomFilter = () => setCustomFilters((f) => [...f, { field: '', value: '' }]);
  const updateCustomFilter = (i, patch) => setCustomFilters((f) => f.map((cf, idx) => idx === i ? { ...cf, ...patch } : cf));
  const removeCustomFilter = (i) => setCustomFilters((f) => f.filter((_, idx) => idx !== i));

  const live = deals.find((d) => d.id === openId) || null;
  if (live) {
    return (
      <div style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', color: C.text }}>
        {confetti && <Confetti onDone={() => setConfetti(false)} />}
        {showFieldMgr && <FieldManager schema={schema} onClose={() => setShowFieldMgr(false)} onAdd={addField} onRemove={removeField} />}
        <DealView deal={live} today={today} schema={schema} onBack={closeDeal} onMove={moveDeal} onSetStatus={setStatus} onAddNote={addNote} onEditHistory={editHistory} onSetActivity={setActivity} onCompleteActivity={completeActivity} onEditField={editField} onManageFields={() => setShowFieldMgr(true)} />
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, height: '100vh', color: C.text, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {confetti && <Confetti onDone={() => setConfetti(false)} />}
      {showFieldMgr && <FieldManager schema={schema} onClose={() => setShowFieldMgr(false)} onAdd={addField} onRemove={removeField} />}
      {/* black nav */}
      <div style={{ background: C.nav, color: '#fff', padding: '10px 16px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0, marginRight: 6 }}>Deals</h1>
        <div style={{ display: 'flex', border: `1px solid #444`, borderRadius: 6, overflow: 'hidden' }}>
          <button onClick={() => setView('pipeline')} style={segBtn(view === 'pipeline')}>Pipeline</button>
          <button onClick={() => setView('list')} style={segBtn(view === 'list')}>List</button>
        </div>
        <button onClick={() => setShowAdd(true)} style={primaryBtn}>+ Add project</button>
        <div style={{ flex: 1 }} />
        {/* search with suggestions + clear */}
        <div style={{ position: 'relative', minWidth: 260 }}>
          <input placeholder="Search…" value={query} onChange={(e) => { setQuery(e.target.value); setShowSuggest(true); }} onFocus={() => setShowSuggest(true)} onBlur={() => setTimeout(() => setShowSuggest(false), 150)} style={{ ...miniInput, width: '100%', boxSizing: 'border-box', paddingRight: 26 }} />
          {query && <span onClick={() => setQuery('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: C.dim, fontSize: 14 }}>✕</span>}
          {showSuggest && suggestions.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 6, marginTop: 2, boxShadow: '0 4px 12px rgba(0,0,0,.15)', maxHeight: 260, overflowY: 'auto' }}>
              {suggestions.map((s, i) => <div key={i} onMouseDown={() => { if (s.id) openDealById(s.id); else setQuery(s.label); setShowSuggest(false); }} style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', borderBottom: `1px solid #f2f3f5`, display: 'flex', justifyContent: 'space-between', color: C.text }}><span>{s.label}</span><span style={{ fontSize: 11, color: C.dim }}>{s.type}</span></div>)}
            </div>
          )}
        </div>
        <span style={{ fontSize: 13, color: '#cfd6dd' }}>{finalList.length} deals · {money0(totalValue)} open</span>
      </div>

      {/* filter bar */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.line}`, padding: '10px 16px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: C.dim }}>Status:</span>
          <div style={{ display: 'flex', gap: 4 }}>{['open','won','lost','all'].map((s) => <button key={s} onClick={() => setStatusFilter(s)} style={chip(statusFilter === s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}</div>
          <span style={sep} />
          <button onClick={() => { setSavedFilter(savedFilter === 'tender' ? null : 'tender'); setMcsnEstimator('all'); }} style={chip(savedFilter === 'tender')}>Tender Review List</button>
          <button onClick={() => { setSavedFilter(savedFilter === 'mcsn' ? null : 'mcsn'); setMcsnEstimator('all'); }} style={chip(savedFilter === 'mcsn')}>MC Secured &amp; Negotiating</button>
          {savedFilter === 'mcsn' && <select value={mcsnEstimator} onChange={(e) => setMcsnEstimator(e.target.value)} style={{ ...miniInput, width: 160 }}><option value="all">All estimators</option>{mcsnEstimators.map((e) => <option key={e} value={e}>{e}</option>)}</select>}
          <span style={sep} />
          {/* stage toggle (pipeline) — swapped order: Stages then separator then Add filter */}
          {view === 'pipeline' && (
            <div style={{ display: 'flex', border: `1px solid ${C.line}`, borderRadius: 16, overflow: 'hidden' }}>
              <button onClick={() => setStageMode('all')} style={toggleBtn(stageMode === 'all')}>All Stages</button>
              <button onClick={() => setStageMode('estimator')} style={toggleBtn(stageMode === 'estimator')}>Estimator Stages Only</button>
            </div>
          )}
          {view === 'list' && <button onClick={() => setShowColPicker((v) => !v)} style={chip(showColPicker)}>Columns ▾</button>}
          <span style={sep} />
          <button onClick={addCustomFilter} style={chip(false)}>+ Add filter</button>
        </div>

        {customFilters.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {customFilters.map((cf, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: C.dim, width: 42 }}>{i === 0 ? 'Where' : 'And'}</span>
                <select value={cf.field} onChange={(e) => updateCustomFilter(i, { field: e.target.value })} style={{ ...miniInput, width: 190 }}><option value="">Select field…</option>{LIST_FIELDS.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}</select>
                <span style={{ fontSize: 12, color: C.dim }}>contains</span>
                <input placeholder="value" value={cf.value} onChange={(e) => updateCustomFilter(i, { value: e.target.value })} style={{ ...miniInput, width: 190 }} />
                <button onClick={() => removeCustomFilter(i)} style={{ ...ghostBtn, padding: '5px 10px' }}>✕</button>
              </div>
            ))}
          </div>
        )}

        {showColPicker && view === 'list' && (
          <div style={panel}>
            <span style={{ fontSize: 12, color: C.dim }}>Columns:</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{LIST_FIELDS.map(([k, lbl]) => <label key={k} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><input type="checkbox" checked={columns.includes(k)} onChange={() => setColumns((prev) => prev.includes(k) ? prev.filter((c) => c !== k) : [...prev, k])} />{lbl}</label>)}</div>
          </div>
        )}
      </div>

      {/* body — board fills height so colour + scrollbar reach the bottom */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: view === 'pipeline' ? '12px 12px 0' : 0 }}>
        {view === 'pipeline' ? (
          <div style={{ display: 'flex', gap: 8, height: '100%', overflowX: 'auto', overflowY: 'hidden', minHeight: 0, paddingBottom: 12 }}>
            {shownStages.map((s) => <BoardColumn key={s.id} stage={s} deals={byStage[s.id] || []} onOpen={openDealById} onDragStart={onDragStart} onDrop={onDrop} today={today} />)}
          </div>
        ) : (
          <ListView deals={listRows} columns={columns} sort={sort} onSort={doSort} onOpen={openDealById} today={today} />
        )}
      </div>

      {showAdd && <AddProjectModal onClose={() => setShowAdd(false)} onCreate={createProject} />}
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
  const NEW_PROJECT_FIELDS = [['title','Project title', true],['value','Value (£)', false],['site_location','Site Location', false],['site_postcode','Postcode', false],['region','Region', false],['size_m2','Size: m2', false],['glenigan_id','Glenigan Project ID', false],['estimator_responsible','Estimator Responsible', false],['project_type','Project Type', false],['systems_priced','Systems Priced', false],['lead_source','Lead Source', false],['scope_of_works','Scope of Works', false]];
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const create = () => { if (!f.title || !f.title.trim()) { alert('Project title is required.'); return; } onCreate({ ...f, organization: org, contact_person: contact, stageId }); };
  return (
    <div style={overlay}>
      <div style={{ ...modal, maxWidth: 640 }}>
        <div style={modalHead}><span style={{ fontSize: 16, fontWeight: 700 }}>Add new project</span><button onClick={onClose} style={xBtn}>✕</button></div>
        <div style={{ padding: 20, overflowY: 'auto', maxHeight: '70vh' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}><label style={fLbl}>Customer (organization)</label><TypeAhead value={org} onChange={setOrg} options={ORGS} placeholder="Type to search customers…" /></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={fLbl}>Customer contact</label><TypeAhead value={contact} onChange={setContact} options={CONTACTS} placeholder="Type to search contacts…" /></div>
            <div><label style={fLbl}>Stage</label><select value={stageId} onChange={(e) => setStageId(e.target.value)} style={{ ...miniInput, width: '100%', boxSizing: 'border-box' }}>{STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
            {NEW_PROJECT_FIELDS.map(([k, lbl, req]) => <div key={k} style={k === 'scope_of_works' || k === 'title' ? { gridColumn: '1 / -1' } : {}}><label style={fLbl}>{lbl}{req ? ' *' : ''}</label><input value={f[k] || ''} onChange={(e) => set(k, e.target.value)} style={{ ...miniInput, width: '100%', boxSizing: 'border-box' }} /></div>)}
          </div>
        </div>
        <div style={modalFoot}><button onClick={onClose} style={ghostBtn}>Cancel</button><button onClick={create} style={primaryBtn}>Create project</button></div>
      </div>
    </div>
  );
}

// ---- styles ---------------------------------------------------------------
const pill = (color) => ({ fontSize: 10, fontWeight: 700, color: '#fff', background: color, padding: '1px 7px', borderRadius: 3 });
const segBtn = (active) => ({ background: active ? C.link : 'transparent', color: '#fff', border: 'none', padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' });
const toggleBtn = (active) => ({ background: active ? C.link : '#fff', color: active ? '#fff' : C.text, border: 'none', padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' });
const chip = (active) => ({ background: active ? '#e5effd' : '#fff', color: active ? C.link : C.text, border: `1px solid ${active ? C.link : C.line}`, borderRadius: 16, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' });
const sep = { width: 1, height: 22, background: C.line, margin: '0 4px', display: 'inline-block' };
const panel = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10, padding: 10, background: '#f7f9fb', border: `1px solid ${C.line}`, borderRadius: 8 };
const backBtn = { background: '#fff', border: `1px solid ${C.line}`, borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: C.text, fontWeight: 600 };
const wlBtn = { borderRadius: 6, padding: '6px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none' };
const primaryBtn = { background: C.link, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const ghostBtn = { background: '#fff', color: C.text, border: `1px solid ${C.line}`, borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const miniBtn = { background: C.link, color: '#fff', border: 'none', borderRadius: 5, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const miniInput = { border: `1px solid ${C.line}`, borderRadius: 6, padding: '7px 9px', fontSize: 13, color: C.text, outline: 'none', background: '#fff', fontFamily: 'inherit' };
const sideHead = { fontSize: 13, fontWeight: 700, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${C.line}` };
const sideRow = { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', fontSize: 12, alignItems: 'flex-start' };
const sideKey = { color: C.dim, flexShrink: 0, maxWidth: 130, paddingTop: 4 };
const sideVal = { color: C.text, textAlign: 'right', wordBreak: 'break-word', paddingTop: 4 };
const sideValLink = { color: C.link, textAlign: 'right', wordBreak: 'break-word', cursor: 'pointer', flex: 1, display: 'flex', justifyContent: 'flex-end', paddingTop: 4 };
const tag = { background: '#eef3fb', border: `1px solid ${C.line}`, borderRadius: 4, padding: '1px 7px', color: C.text };
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
