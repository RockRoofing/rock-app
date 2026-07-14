// pages/crm.js
// -----------------------------------------------------------------------------
// CRM PREVIEW (admin-only once guard enabled at bottom)
// SELF-CONTAINED: baked-in seed data, all changes in browser memory only.
// Refreshing resets everything. Nothing here touches your live DB or dashboards.
//
// Deep-link: /crm?deal=12345 opens that deal directly (used by @mention emails).
// View/column prefs persist for the SESSION; reset on full refresh. When auth +
// persistence land, they save per-user to KV.
// -----------------------------------------------------------------------------

import { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import { SEED_DEALS, PREVIEW_TODAY } from '../lib/crmSeedDeals';
import { ORGS, CONTACTS } from '../lib/crmDirectory';
import { DEFAULT_FIELD_SCHEMA, MENTION_USERS } from '../lib/crmFieldSchema';

const STAGES = [
  { id: 'stage_project_in', label: 'Project In' }, { id: 'stage_1st_contact', label: '1st Contact' },
  { id: 'stage_calls_x3', label: 'Calls x 3' }, { id: 'stage_in_abeyance', label: 'In Abeyance' },
  { id: 'stage_tbf', label: 'TBF' }, { id: 'stage_mc_unsec_np', label: 'MC Unsecured Not Priced' },
  { id: 'stage_info_pending', label: 'info Pending' }, { id: 'stage_received', label: 'Received' },
  { id: 'stage_1', label: 'Stage 1' }, { id: 'stage_2', label: 'Stage 2' }, { id: 'stage_review', label: 'Review' },
  { id: 'stage_mc_unsecured', label: 'MC Unsecured' }, { id: 'stage_variations', label: 'Variations' },
  { id: 'stage_mc_secured', label: 'MC Secured' }, { id: 'stage_negotiating', label: 'Negotiating' },
];
const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.id, i]));
const stageLabel = (id) => (STAGES.find((s) => s.id === id) || {}).label || id;

const ORANGE_STAGES = new Set(['stage_project_in','stage_1st_contact','stage_calls_x3','stage_in_abeyance','stage_tbf','stage_mc_unsec_np','stage_info_pending']);
const BLUE_STAGES = new Set(['stage_received','stage_1','stage_2','stage_review','stage_mc_unsecured','stage_variations','stage_mc_secured','stage_negotiating']);
const ESTIMATOR_STAGES = ['stage_received','stage_1','stage_2','stage_review','stage_mc_unsecured','stage_variations','stage_mc_secured','stage_negotiating'];
function columnBg(id) { if (ORANGE_STAGES.has(id)) return '#fdf1e3'; if (BLUE_STAGES.has(id)) return '#e8f1fb'; return '#f4f5f7'; }

const LIST_FIELDS = [
  ['title', 'Title'], ['organization', 'Organization'], ['contact_person', 'Contact'], ['value', 'Value'],
  ['owner', 'Owner'], ['estimator_responsible', 'Estimator Responsible'], ['stageId', 'Stage'], ['status', 'Status'],
  ['next_activity', 'Next Activity Date'], ['region', 'Region'], ['project_type', 'Project Type'],
  ['systems_priced', 'Systems Priced'], ['lead_source', 'Lead Source'], ['site_location', 'Site Location'],
  ['site_postcode', 'Postcode'], ['size_m2', 'Size: m2'], ['credit_score', 'Credit Score'],
  ['glenigan_id', 'Glenigan ID'], ['project_stage', 'Project Stage'], ['expected_close_date', 'Tender Return date'], ['created', 'Created'],
];
const DEFAULT_COLUMNS = ['title','organization','contact_person','value','stageId','next_activity','estimator_responsible','status'];

// Company / Contact list columns
const COMPANY_FIELDS = [['name','Company name'],['org_address','Address'],['org_phone','Phone'],['org_website','Website'],['org_email','Email'],['org_reg_number','Registration Number'],['supply_chain_approved','Supply Chain Approved?'],['deals','Deals'],['open_value','Open value'],['won','Won'],['lost','Lost']];
const DEFAULT_COMPANY_COLUMNS = COMPANY_FIELDS.map((f) => f[0]);
const CONTACT_FIELDS = [['name','Name'],['first_name','First name'],['last_name','Last name'],['organization','Company'],['contact_phone','Phone'],['contact_email','Email'],['contact_job_role','Job Role'],['deals','Deals'],['open_value','Open value']];
const DEFAULT_CONTACT_COLUMNS = CONTACT_FIELDS.map((f) => f[0]);

// ---- helpers --------------------------------------------------------------
const money = (v) => { const n = Number(v); return isNaN(n) ? '£0' : '£' + n.toLocaleString('en-GB', { maximumFractionDigits: 2 }); };
const money0 = (v) => { const n = Number(v); return isNaN(n) ? '£0' : '£' + n.toLocaleString('en-GB', { maximumFractionDigits: 0 }); };
const shortDate = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
const dateTime = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const nowIso = () => new Date().toISOString();
const firstName = (n) => n ? String(n).trim().split(/\s+/)[0] : '';
const lastName = (n) => { if (!n) return ''; const p = String(n).trim().split(/\s+/); return p.length > 1 ? p.slice(1).join(' ') : ''; };
const uid = () => 'x' + Math.random().toString(36).slice(2, 9);
const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

// dot state: warning=none, red=before today, green=today, grey=after today
function dealDotState(deal, today) {
  if (deal.status !== 'open') return null;
  const open = (deal.activities || []).filter((a) => !a.done);
  if (open.length === 0) return 'none';
  if (open.some((a) => a.due < today)) return 'overdue';
  if (open.some((a) => a.due === today)) return 'today';
  return 'future';
}
function nextActivityDate(deal) { const open = (deal.activities || []).filter((a) => !a.done); if (!open.length) return ''; return open.map((a) => a.due).sort()[0]; }
function cellValue(deal, key) {
  if (key === 'stageId') return stageLabel(deal.stageId);
  if (key === 'title') return deal.title;
  if (key === 'status') return deal.status;
  if (key === 'next_activity') return nextActivityDate(deal);
  const v = deal.fields[key]; return v === null || v === undefined ? '' : v;
}
function displayCell(deal, key) {
  const v = cellValue(deal, key);
  if (key === 'value') return money(deal.fields.value);
  if (key === 'created' || key === 'expected_close_date' || key === 'next_activity') return shortDate(v) || '-';
  if (key === 'size_m2') { const n = Number(v); return isNaN(n) || v === '' ? '-' : n.toLocaleString('en-GB'); }
  if (key === 'status') return v ? v[0].toUpperCase() + v.slice(1) : '-';
  return v === '' ? '-' : String(v);
}

const FONT = "'Plus Jakarta Sans', system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const C = {
  greenBar: '#3a9c3e', grey: '#e4e7ea', line: '#e1e4e8', text: '#1a1a1a', dim: '#7a828a',
  link: '#2a7de1', bg: '#f4f5f7', card: '#ffffff', won: '#2a862f', lost: '#d64545',
  amber: '#f5a623', red: '#ff3b30', green: '#25c249', dotGrey: '#9aa3ab',
  nav: '#1c1c1c', note: '#fff7cc', noteBorder: '#f2e08a', activityBg: '#eaf3ff',
  activityBorder: '#c5ddf7', feedBg: '#f6f8fa', mention: '#e5effd',
  sideBox: '#f7f8fa', // very light grey box in sidebar (only slightly off white)
  noteSaved: '#fffce8', // slightly lighter yellow for saved notes
  faint: '#f0f2f4', // very faint vertical column lines
  wonTint: '#e7fbe9', // light bright green background when won
  lostTint: '#ffe9e7', // light bright red background when lost
};

// ===========================================================================
// Confetti
// ===========================================================================
function Confetti({ onDone, message = '🎉 Deal Won! 🎉', color }) {
  useEffect(() => { const t = setTimeout(onDone, 2600); return () => clearTimeout(t); }, [onDone]);
  const pieces = useMemo(() => Array.from({ length: 90 }, (_, i) => ({ id: i, left: Math.random() * 100, delay: Math.random() * 0.5, dur: 1.8 + Math.random() * 1.2, color: ['#2a862f','#2a7de1','#e6a817','#d64545','#7c4dff','#00bcd4'][i % 6], rot: Math.random() * 360, size: 6 + Math.random() * 8 })), []);
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 200, overflow: 'hidden' }}>
      <style>{`@keyframes crmfall{0%{transform:translateY(-20px) rotate(0);opacity:1}100%{transform:translateY(105vh) rotate(720deg);opacity:.9}}@keyframes crmpop{0%{transform:scale(.6);opacity:0}100%{transform:scale(1);opacity:1}}`}</style>
      {pieces.map((p) => <div key={p.id} style={{ position: 'absolute', top: -20, left: p.left + '%', width: p.size, height: p.size * 0.6, background: p.color, transform: `rotate(${p.rot}deg)`, animation: `crmfall ${p.dur}s ${p.delay}s ease-in forwards` }} />)}
      <div style={{ position: 'absolute', top: '32%', left: 0, right: 0, textAlign: 'center', fontSize: 36, fontWeight: 800, color: color || C.won, textShadow: '0 2px 8px rgba(0,0,0,.15)', animation: 'crmpop .4s ease-out', padding: '0 20px' }}>{message}</div>
    </div>
  );
}

// ===========================================================================
// Font loader (Plus Jakarta Sans) — CRM only
// ===========================================================================
function FontLoader() {
  return <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');`}</style>;
}

// ===========================================================================
// Type-ahead
// ===========================================================================

function TypeAhead({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => { const q = (value || '').trim().toLowerCase(); if (!q) return []; return options.filter((o) => o.toLowerCase().includes(q)).slice(0, 8); }, [value, options]);
  return (
    <div style={{ position: 'relative' }}>
      <input value={value || ''} placeholder={placeholder} onChange={(e) => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} style={{ ...miniInput, width: '100%', boxSizing: 'border-box' }} />
      {open && matches.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 40, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 6, marginTop: 2, boxShadow: '0 4px 12px rgba(0,0,0,.12)', maxHeight: 220, overflowY: 'auto' }}>
          {matches.map((m) => <div key={m} onMouseDown={() => { onChange(m); setOpen(false); }} style={{ padding: '7px 10px', fontSize: 13, cursor: 'pointer', borderBottom: `1px solid #f2f3f5` }}>{m}</div>)}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Mention textarea
// ===========================================================================
function MentionInput({ value, onChange, placeholder, rows }) {
  const [showList, setShowList] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  const matches = MENTION_USERS.filter((u) => u.name.toLowerCase().includes(q.toLowerCase()) || u.username.includes(q.toLowerCase())).slice(0, 6);
  const onInput = (e) => { const val = e.target.value; onChange(val); const m = /@(\w*)$/.exec(val.slice(0, e.target.selectionStart)); if (m) { setQ(m[1]); setShowList(true); } else setShowList(false); };
  const pick = (u) => { const el = ref.current; const pos = el.selectionStart; const before = value.slice(0, pos).replace(/@(\w*)$/, `@${u.name} `); const after = value.slice(pos); onChange(before + after); setShowList(false); setTimeout(() => el.focus(), 0); };
  return (
    <div style={{ position: 'relative' }}>
      <textarea ref={ref} value={value} onChange={onInput} placeholder={placeholder} rows={rows || 2} style={{ width: '100%', resize: 'vertical', boxSizing: 'border-box', border: 'none', outline: 'none', fontSize: 14, fontFamily: 'inherit', background: 'transparent' }} />
      {showList && matches.length > 0 && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, zIndex: 40, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 6, marginBottom: 4, boxShadow: '0 4px 12px rgba(0,0,0,.15)', minWidth: 160 }}>
          {matches.map((u) => <div key={u.username} onMouseDown={() => pick(u)} style={{ padding: '7px 12px', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 22, height: 22, borderRadius: '50%', background: C.mention, color: C.link, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{u.name[0]}</span>{u.name}</div>)}
        </div>
      )}
    </div>
  );
}
function extractMentions(text) { const names = MENTION_USERS.map((u) => u.name); return names.filter((n) => new RegExp(`@${n}\\b`, 'i').test(text || '')); }

// ===========================================================================
// Tick-box multi-select (click to open, tick items, click away to close)
// ===========================================================================
function MultiSelect({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = String(value || '').split(', ').filter(Boolean);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const toggle = (o) => { const next = selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]; onChange(next.join(', ')); };
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <div onClick={() => setOpen((v) => !v)} style={{ ...miniInput, width: '100%', boxSizing: 'border-box', cursor: 'pointer', minHeight: 20, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {selected.length === 0 && <span style={{ color: C.dim }}>{placeholder || 'Select…'}</span>}
        {selected.map((s) => <span key={s} style={{ ...tag, display: 'inline-flex', alignItems: 'center', gap: 4 }}>{s}<span onClick={(e) => { e.stopPropagation(); toggle(s); }} style={{ cursor: 'pointer', color: C.dim }}>✕</span></span>)}
        <span style={{ marginLeft: 'auto', color: C.dim, fontSize: 11 }}>▾</span>
      </div>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 6, marginTop: 2, boxShadow: '0 4px 12px rgba(0,0,0,.15)', maxHeight: 240, overflowY: 'auto' }}>
          {(options || []).map((o) => {
            const on = selected.includes(o);
            return (
              <div key={o} onClick={() => toggle(o)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', fontSize: 13, cursor: 'pointer', borderBottom: `1px solid #f2f3f5` }}>
                <span style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${on ? C.link : C.dim}`, background: on ? C.link : '#fff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>{on ? '✓' : ''}</span>
                {o}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Dots
// ===========================================================================
function Dot({ state, size = 14 }) {
  if (state === 'none') return <span title="No activity set" style={{ color: C.amber, fontSize: size + 6, lineHeight: 1 }}>⚠</span>;
  const color = state === 'overdue' ? C.red : state === 'today' ? C.green : C.dotGrey;
  const title = state === 'overdue' ? 'Activity overdue' : state === 'today' ? 'Activity due today' : 'Activity due in future';
  const glow = state === 'overdue' || state === 'today' ? `0 0 6px ${color}` : 'none';
  return <span title={title} style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'inline-block', boxShadow: glow }} />;
}

// ===========================================================================
// Comment thread (used under notes, both in Notes section & History)
// ===========================================================================
function CommentThread({ comments, onAdd }) {
  const [text, setText] = useState('');
  return (
    <div style={{ marginTop: 8, paddingLeft: 14, borderLeft: `2px solid ${C.line}` }}>
      {(comments || []).map((c) => (
        <div key={c.id} style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{c.author || 'Unassigned user'} <span style={{ fontWeight: 400, color: C.dim }}>· {dateTime(c.ts)}</span></div>
          <div style={{ fontSize: 13, color: C.text, whiteSpace: 'pre-wrap' }}>{c.body}</div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 4, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 6, padding: 4 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment…" style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, padding: '4px 6px', background: '#fff', fontFamily: 'inherit' }}
          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { onAdd(text.trim()); setText(''); } }} />
        <button disabled={!text.trim()} onClick={() => { onAdd(text.trim()); setText(''); }} style={{ ...miniBtn, opacity: text.trim() ? 1 : 0.5 }}>Save</button>
      </div>
    </div>
  );
}

// ===========================================================================
// Board card + CHEVRON column
// ===========================================================================
function BoardCard({ deal, onOpen, onDragStart, today }) {
  const st = dealDotState(deal, today);
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
function BoardColumn({ stage, deals, onOpen, onDragStart, onDrop, today, isFirst }) {
  const [over, setOver] = useState(false);
  const total = deals.reduce((s, d) => s + (Number(d.fields.value) || 0), 0);
  const bg = over ? '#dbe8fb' : columnBg(stage.id);
  // chevron header shape
  const notch = 12;
  const headerClip = isFirst
    ? `polygon(0 0, calc(100% - ${notch}px) 0, 100% 50%, calc(100% - ${notch}px) 100%, 0 100%)`
    : `polygon(0 0, calc(100% - ${notch}px) 0, 100% 50%, calc(100% - ${notch}px) 100%, 0 100%, ${notch}px 50%)`;
  return (
    <div style={{ minWidth: 212, maxWidth: 212, flex: '0 0 212px', display: 'flex', flexDirection: 'column', height: '100%', marginRight: -6 }}>
      {/* chevron header */}
      <div style={{ background: bg, clipPath: headerClip, padding: `8px 16px 8px ${isFirst ? 12 : 20}px`, marginBottom: 2 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{stage.label}</div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{money0(total)} · {deals.length} deals</div>
      </div>
      {/* body */}
      <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { setOver(false); onDrop(e, stage.id); }}
        style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: bg, borderRadius: '0 0 8px 8px', padding: 8, marginLeft: isFirst ? 0 : notch }}>
        {deals.map((d) => <BoardCard key={d.id} deal={d} onOpen={onOpen} onDragStart={onDragStart} today={today} />)}
        <div style={{ minHeight: 120 }} />
      </div>
    </div>
  );
}

// ===========================================================================
// Timeline bar (tight gaps, hover day-count scaffold, current-stage label only)
// ===========================================================================
function TimelineBar({ deal, onMove }) {
  const cur = STAGE_INDEX[deal.stageId];
  // stageDays: map stageId -> days in stage. Not available from import yet.
  // When persistence records stage-entry timestamps we compute real values here.
  const stageDays = deal.stageDays || {};
  return (
    <div style={{ display: 'flex', gap: 1, padding: '10px 0' }}>
      {STAGES.map((s, i) => {
        const passed = i <= cur;
        const days = stageDays[s.id];
        const title = days != null ? `${s.label}: ${days} day${days === 1 ? '' : 's'}` : s.label;
        return (
          <div key={s.id} title={title} onClick={() => onMove(deal.id, s.id)} style={{ flex: 1, height: 22, cursor: 'pointer', position: 'relative', background: passed ? C.greenBar : C.grey, clipPath: 'polygon(0 0, calc(100% - 7px) 0, 100% 50%, calc(100% - 7px) 100%, 0 100%, 7px 50%)' }}>
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, color: passed ? '#fff' : C.dim, whiteSpace: 'nowrap', overflow: 'hidden' }}>{i === cur ? s.label : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// Collapsible sidebar box
// ===========================================================================
function SideBox({ title, action, children, collapsed, onToggle }) {
  return (
    <div style={{ background: C.sideBox, borderRadius: 8, padding: 12, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={onToggle}>
        <span style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform .15s', fontSize: 11 }}>▼</span>{title}
        </span>
        {action}
      </div>
      {!collapsed && <div style={{ marginTop: 8 }}>{children}</div>}
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
  const save = (v) => { onSave(field.key, field.type === 'yesno' ? (v === 'Yes' || v === true) : v); setEditing(false); };
  if (!editing) return <span style={sideValLink} onClick={() => setEditing(true)}>{field.type === 'select' && value ? <span style={tag}>{value}</span> : display()}</span>;
  if (field.search) return (
    <span style={{ display: 'flex', gap: 4, flexDirection: 'column', width: '100%' }}>
      <TypeAhead value={draft} onChange={setDraft} options={field.search === 'org' ? ORGS : CONTACTS} placeholder={field.search === 'org' ? 'Search customers…' : 'Search contacts…'} />
      <span style={{ display: 'flex', gap: 4 }}><button onClick={() => save(draft)} style={miniBtn}>Save</button><button onClick={() => setEditing(false)} style={ghostBtn}>Cancel</button></span>
    </span>);
  const cp = { autoFocus: true, value: draft, onChange: (e) => setDraft(e.target.value), style: { ...miniInput, width: '100%', boxSizing: 'border-box' } };
  return (
    <span style={{ display: 'flex', gap: 4, flexDirection: 'column', width: '100%' }}>
      {(field.type === 'text' || field.type === 'number' || field.type === 'currency') && <input type={field.type === 'text' ? 'text' : 'number'} {...cp} />}
      {field.type === 'date' && <input type="date" {...cp} />}
      {field.type === 'yesno' && <select {...cp}><option>Yes</option><option>No</option></select>}
      {field.type === 'select' && <select {...cp}><option value="">-</option>{(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}</select>}
      {field.type === 'multiselect' && <MultiSelect value={draft} onChange={setDraft} options={field.options || []} placeholder="Select…" />}
      <span style={{ display: 'flex', gap: 4 }}><button onClick={() => save(draft)} style={miniBtn}>Save</button><button onClick={() => setEditing(false)} style={ghostBtn}>Cancel</button></span>
    </span>
  );
}

// ===========================================================================
// Field manager
// ===========================================================================
function FieldManager({ schema, onClose, onAdd, onRemove }) {
  const [label, setLabel] = useState(''); const [type, setType] = useState('text'); const [group, setGroup] = useState('details'); const [opts, setOpts] = useState('');
  const add = () => { if (!label.trim()) { alert('Field name required'); return; } const key = 'custom_' + label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'); onAdd({ key, label: label.trim(), type, group, options: (type === 'select' || type === 'multiselect') ? opts.split(',').map((o) => o.trim()).filter(Boolean) : undefined }); setLabel(''); setOpts(''); };
  return (
    <div style={overlay}><div style={{ ...modal, maxWidth: 560 }}>
      <div style={modalHead}><span style={{ fontSize: 16, fontWeight: 700 }}>Customise fields</span><button onClick={onClose} style={xBtn}>✕</button></div>
      <div style={{ padding: 20, overflowY: 'auto', maxHeight: '70vh' }}>
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 8, fontWeight: 700 }}>Add a field</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <input placeholder="Field name" value={label} onChange={(e) => setLabel(e.target.value)} style={miniInput} />
          <select value={group} onChange={(e) => setGroup(e.target.value)} style={miniInput}><option value="summary">Summary</option><option value="details">Details</option><option value="person">Customer Contact</option><option value="organization">Organization</option></select>
          <select value={type} onChange={(e) => setType(e.target.value)} style={miniInput}><option value="text">Text</option><option value="number">Number</option><option value="currency">Currency</option><option value="date">Date</option><option value="select">Dropdown</option><option value="multiselect">Multi-select</option><option value="yesno">Yes/No</option></select>
          {(type === 'select' || type === 'multiselect') && <input placeholder="Options, comma-separated" value={opts} onChange={(e) => setOpts(e.target.value)} style={miniInput} />}
        </div>
        <button onClick={add} style={primaryBtn}>Add field</button>
        <div style={{ fontSize: 12, color: C.dim, margin: '18px 0 8px', fontWeight: 700 }}>Current fields</div>
        {['summary','details','person','organization'].map((g) => (
          <div key={g} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', color: C.dim, fontWeight: 700, marginBottom: 4 }}>{g === 'person' ? 'Customer Contact' : g}</div>
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
    </div></div>
  );
}

// ===========================================================================
// Column chooser (generic; used by List, Companies, Contacts)
// ===========================================================================
function ColumnChooser({ title, fields, columns, onToggle, onClose }) {
  return (
    <div style={overlay}><div style={{ ...modal, maxWidth: 420 }}>
      <div style={modalHead}><span style={{ fontSize: 16, fontWeight: 700 }}>{title}</span><button onClick={onClose} style={xBtn}>✕</button></div>
      <div style={{ padding: 20, overflowY: 'auto', maxHeight: '70vh' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {fields.map(([k, lbl]) => <label key={k} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}><input type="checkbox" checked={columns.includes(k)} onChange={() => onToggle(k)} />{lbl}</label>)}
        </div>
      </div>
      <div style={modalFoot}><button onClick={onClose} style={primaryBtn}>Done</button></div>
    </div></div>
  );
}

// ===========================================================================
// Activity row (editable text+date combined, complete, delete)
// ===========================================================================
function ActivityRow({ activity, onEdit, onComplete, onDelete, overdue }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(activity.text);
  const [due, setDue] = useState(activity.due);
  return (
    <div style={{ border: `1px solid ${overdue ? C.red : C.activityBorder}`, background: '#fff', borderRadius: 6, padding: 10, marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: .4, marginBottom: 4 }}>Activity</div>
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input value={text} onChange={(e) => setText(e.target.value)} style={miniInput} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ ...miniInput, width: 150 }} />
            <button onClick={() => { onEdit(activity.id, text || 'Call', due); setEditing(false); }} style={miniBtn}>Save</button>
            <button onClick={() => setEditing(false)} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div>
            <div style={{ fontSize: 14 }}>{activity.text}</div>
            <div style={{ fontSize: 12, color: overdue ? C.red : C.dim, marginTop: 2 }}>Due {shortDate(activity.due)}{overdue ? ' · OVERDUE' : ''} · Assigned to {activity.assignee || 'current user'}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button onClick={() => onComplete(activity.id)} style={miniBtn}>Done</button>
            <button onClick={() => setEditing(true)} style={ghostBtn}>Edit</button>
            <button onClick={() => onDelete(activity.id)} style={{ ...ghostBtn, color: C.lost, padding: '5px 8px' }}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// History feed (combined edit for activities incl date + reopen; comments on notes)
// ===========================================================================
function historyIcon(t) { return ({ note: '📝', activity: '📞', stage: '↗', value: '£', close: '📅', won: '✓', lost: '✕', import: '⬇', mention: '@' })[t] || '•'; }
function HistoryItem({ h, onEdit, onEditActivity, onDelete, onReopen, onComment }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(h.body || '');
  const [date, setDate] = useState(h.ts ? new Date(h.ts).toISOString().slice(0, 16) : '');
  const [showComments, setShowComments] = useState(false);
  const isNote = h.type === 'note';
  const isActivity = h.type === 'activity';
  return (
    <div style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: `1px solid ${C.line}` }}>
      <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#fff', border: `1px solid ${C.line}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>{historyIcon(h.type)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: C.text, lineHeight: 1.4 }}>{h.text}{(h.type === 'note' || h.type === 'activity') && h.author ? <span style={{ color: C.dim }}> · {h.author}</span> : ''}</div>
        {editing ? (
          <div style={{ marginTop: 4 }}>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, border: `1px solid ${C.line}`, borderRadius: 6, padding: 6, fontFamily: 'inherit' }} />
            {isActivity && <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...miniInput, marginTop: 6 }} />}
            <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button onClick={() => { if (isActivity) onEditActivity(h.id, body, date ? new Date(date).toISOString() : h.ts); else onEdit(h.id, body); setEditing(false); }} style={miniBtn}>Save</button>
              <button onClick={() => setEditing(false)} style={ghostBtn}>Cancel</button>
            </div>
          </div>
        ) : (h.body && <div style={{ fontSize: 13, color: '#444', marginTop: 3, whiteSpace: 'pre-wrap' }}>{h.body}</div>)}

        <div style={{ fontSize: 11, color: C.dim, marginTop: 3, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{dateTime(h.ts)}{h.edited ? ' · edited' : ''}</span>
          {(isNote || isActivity) && !editing && <span onClick={() => setEditing(true)} style={{ color: C.link, cursor: 'pointer' }}>Edit</span>}
          {isActivity && <span onClick={() => onReopen(h.id)} style={{ color: C.link, cursor: 'pointer' }}>Reopen / Mark undone</span>}
          {(isNote || isActivity) && <span onClick={() => onDelete(h.id)} style={{ color: C.lost, cursor: 'pointer' }}>Delete</span>}
          {isNote && <span onClick={() => setShowComments((v) => !v)} style={{ color: C.link, cursor: 'pointer' }}>{showComments ? 'Hide' : 'Comment'} ({(h.comments || []).length})</span>}
        </div>
        {isNote && showComments && <CommentThread comments={h.comments} onAdd={(body) => onComment(h.id, body)} />}
      </div>
    </div>
  );
}
function HistoryFeed(props) {
  const sorted = [...props.history].sort((a, b) => new Date(b.ts) - new Date(a.ts));
  return (
    <div>
      {sorted.map((h) => <HistoryItem key={h.id} h={h} {...props} />)}
      {sorted.length === 0 && <div style={{ fontSize: 13, color: C.dim, padding: '16px 0' }}>No history yet.</div>}
    </div>
  );
}

// ===========================================================================
// Deal view
// ===========================================================================
function DealView({ deal, today, schema, onBack, onMove, onSetStatus, onAddNote, onCommentNote, onEditHistory, onEditHistoryActivity, onDeleteHistory, onReopenActivity, onAddActivity, onEditActivity, onCompleteActivity, onDeleteActivity, onEditField, onManageFields }) {
  const [noteText, setNoteText] = useState('');
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState('');
  const [newDue, setNewDue] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [flash, setFlash] = useState(false);
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(false), 800); return () => clearTimeout(t); }, [flash]);

  // Warn when leaving an open deal that has no open activity set.
  const needsActivityWarning = deal.status === 'open' && (deal.activities || []).filter((a) => !a.done).length === 0;
  const guardedBack = () => {
    if (needsActivityWarning) {
      const ok = window.confirm('You have not set an activity for this project. Are you sure you want to leave?');
      if (!ok) return;
    }
    onBack();
  };
  // Browser tab-close / refresh gets the generic browser prompt (custom text not allowed by browsers).
  useEffect(() => {
    const handler = (e) => { if (needsActivityWarning) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [needsActivityWarning]);
  const [collapsed, setCollapsed] = useState({});
  const toggle = (g) => setCollapsed((p) => ({ ...p, [g]: !p[g] }));
  const groupFields = (g) => schema.filter((f) => f.group === g);
  const openActs = (deal.activities || []).filter((a) => !a.done).sort((a, b) => a.due.localeCompare(b.due));
  const noteHistory = deal.history.filter((h) => h.type === 'note').sort((a, b) => new Date(b.ts) - new Date(a.ts));
  const summaryFields = groupFields('summary').map((f) => f.key === 'organization' ? { ...f, search: 'org' } : f.key === 'contact_person' ? { ...f, search: 'contact' } : f);

  const statusTint = deal.status === 'won' ? C.wonTint : deal.status === 'lost' ? C.lostTint : C.card;
  return (
    <div style={{ background: statusTint, minHeight: '100vh' }}>
      <div style={{ background: C.nav, color: '#fff', padding: '10px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={guardedBack} style={{ ...backBtn, background: 'transparent', color: '#fff', borderColor: '#444' }}>← Deals</button>
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
        {/* LEFT — collapsible grey boxes on white */}
        <div style={{ width: 330, flexShrink: 0, borderRight: `1px solid ${C.line}`, padding: 16, boxSizing: 'border-box', background: statusTint }}>
          <SideBox title="Summary" collapsed={collapsed.summary} onToggle={() => toggle('summary')}>
            {summaryFields.map((f) => <div key={f.key + f.label} style={sideRow}><span style={sideKey}>{f.label}</span><EditableField field={f} value={deal.fields[f.key]} onSave={(k, v) => onEditField(deal.id, k, v)} /></div>)}
          </SideBox>
          <SideBox title="Details" collapsed={collapsed.details} onToggle={() => toggle('details')}>
            {groupFields('details').map((f) => <div key={f.key + f.label} style={sideRow}><span style={sideKey}>{f.label}</span><EditableField field={f} value={deal.fields[f.key]} onSave={(k, v) => onEditField(deal.id, k, v)} /></div>)}
          </SideBox>
          <SideBox title="Customer Contact" collapsed={collapsed.person} onToggle={() => toggle('person')}>
            <div style={sideRow}><span style={sideKey}>Name</span><EditableField field={{ key: 'contact_person', type: 'text', search: 'contact' }} value={deal.fields.contact_person} onSave={(k, v) => onEditField(deal.id, k, v)} /></div>
            <div style={sideRow}><span style={sideKey}>First name</span><span style={sideVal}>{firstName(deal.fields.contact_person) || '-'}</span></div>
            <div style={sideRow}><span style={sideKey}>Last name</span><span style={sideVal}>{lastName(deal.fields.contact_person) || '-'}</span></div>
            {groupFields('person').filter((f) => f.key !== 'contact_person').map((f) => <div key={f.key + f.label} style={sideRow}><span style={sideKey}>{f.label}</span><EditableField field={f} value={deal.fields[f.key]} onSave={(k, v) => onEditField(deal.id, k, v)} /></div>)}
          </SideBox>
          <SideBox title="Organization" collapsed={collapsed.organization} onToggle={() => toggle('organization')}>
            <div style={sideRow}><span style={sideKey}>Company name</span><EditableField field={{ key: 'organization', type: 'text', search: 'org' }} value={deal.fields.organization} onSave={(k, v) => onEditField(deal.id, k, v)} /></div>
            {groupFields('organization').map((f) => <div key={f.key + f.label} style={sideRow}><span style={sideKey}>{f.label}</span><EditableField field={f} value={deal.fields[f.key]} onSave={(k, v) => onEditField(deal.id, k, v)} /></div>)}
          </SideBox>
          <button onClick={onManageFields} style={{ ...ghostBtn, width: '100%', marginTop: 4 }}>⚙ Customise fields</button>
        </div>

        {/* CENTRE */}
        <div style={{ flex: 1, padding: 20, minWidth: 0, background: deal.status === 'open' ? C.feedBg : statusTint }}>
          {/* Activities to do */}
          <style>{`@keyframes crmflash{0%{box-shadow:0 0 0 0 rgba(37,194,73,0)}30%{box-shadow:0 0 0 4px rgba(37,194,73,.55)}100%{box-shadow:0 0 0 0 rgba(37,194,73,0)}}`}</style>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Activities to do</div>
          <div style={{ background: C.activityBg, border: `1px solid ${flash ? C.green : C.activityBorder}`, borderRadius: 8, padding: 14, animation: flash ? 'crmflash .8s ease-out' : 'none' }}>
            {(openActs.length > 0) && <div style={{ textAlign: 'right', marginBottom: 10 }}><button onClick={() => setAdding((v) => !v)} style={primaryBtn}>+ Add activity</button></div>}
            {(adding || openActs.length === 0) && (
              <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 6, padding: 10, marginBottom: openActs.length ? 10 : 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: .4, marginBottom: 4 }}>Activity</div>
                <MentionInput value={newText} onChange={setNewText} placeholder="Call…" rows={2} />
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                  <input type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} style={{ ...miniInput, width: 150 }} />
                  <span style={{ fontSize: 12, color: C.dim }}>Assign to</span>
                  <select value={newAssignee} onChange={(e) => setNewAssignee(e.target.value)} style={{ ...miniInput, width: 150 }}>
                    <option value="">(current user)</option>
                    {MENTION_USERS.map((u) => <option key={u.username} value={u.name}>{u.name}</option>)}
                  </select>
                  <button disabled={!newDue} onClick={() => { onAddActivity(deal.id, newText.trim() || 'Call', newDue, newAssignee); setNewText(''); setNewDue(''); setNewAssignee(''); setAdding(false); }} style={{ ...primaryBtn, opacity: newDue ? 1 : 0.5 }}>Save</button>
                  {openActs.length > 0 && <button onClick={() => setAdding(false)} style={ghostBtn}>Cancel</button>}
                </div>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>Assigning someone else emails them (email would send in live version). Assigning yourself sends no email.</div>
              </div>
            )}
            {openActs.map((a) => <ActivityRow key={a.id} activity={a} overdue={a.due < today} onEdit={(id, t, d) => onEditActivity(deal.id, id, t, d)} onComplete={(id) => { onCompleteActivity(deal.id, id); setFlash(true); setAdding(true); }} onDelete={(id) => onDeleteActivity(deal.id, id)} />)}
          </div>

          <div style={{ borderTop: `3px solid #fff`, margin: '20px 0' }} />

          {/* Notes */}
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Notes</div>
          <div style={{ background: C.note, border: `1px solid ${C.noteBorder}`, borderRadius: 8, padding: 12 }}>
            <MentionInput value={noteText} onChange={setNoteText} placeholder="Take a note… (type @ to notify someone)" rows={2} />
            <div style={{ textAlign: 'right', marginTop: 6 }}><button disabled={!noteText.trim()} onClick={() => { onAddNote(deal.id, noteText.trim()); setNoteText(''); }} style={{ ...primaryBtn, opacity: noteText.trim() ? 1 : 0.5 }}>Add note</button></div>
          </div>
          {/* saved notes with comment threads, staying in Notes section */}
          {noteHistory.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {noteHistory.map((h) => (
                <div key={h.id} style={{ background: C.noteSaved, border: `1px solid ${C.noteBorder}`, borderRadius: 8, padding: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{h.author || 'Unassigned user'} <span style={{ fontWeight: 400, color: C.dim }}>· {dateTime(h.ts)}{h.edited ? ' · edited' : ''}</span></div>
                  <div style={{ fontSize: 13, color: C.text, whiteSpace: 'pre-wrap', marginTop: 3 }}>{h.body}</div>
                  <CommentThread comments={h.comments} onAdd={(body) => onCommentNote(deal.id, h.id, body)} />
                </div>
              ))}
            </div>
          )}

          <div style={{ borderTop: `3px solid #fff`, margin: '20px 0' }} />

          {/* History */}
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>History</div>
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 8 }}>All activity, newest first · notes & activities editable, deletable, commentable</div>
          <HistoryFeed history={deal.history}
            onEdit={(hid, body) => onEditHistory(deal.id, hid, body)}
            onEditActivity={(hid, body, ts) => onEditHistoryActivity(deal.id, hid, body, ts)}
            onDelete={(hid) => onDeleteHistory(deal.id, hid)}
            onReopen={(hid) => onReopenActivity(deal.id, hid)}
            onComment={(hid, body) => onCommentNote(deal.id, hid, body)} />
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// List view (deals)
// ===========================================================================
// ===========================================================================
// Resizable-column helper (drag the header border to widen/narrow)
// ===========================================================================
function useColWidths(keys, initial = 150) {
  const [widths, setWidths] = useState(() => Object.fromEntries(keys.map((k) => [k, initial])));
  useEffect(() => { setWidths((w) => { const n = { ...w }; keys.forEach((k) => { if (n[k] == null) n[k] = initial; }); return n; }); }, [keys.join(',')]);
  const startResize = (key, e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX; const startW = widths[key] || initial;
    const move = (ev) => setWidths((w) => ({ ...w, [key]: Math.max(60, startW + (ev.clientX - startX)) }));
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  return { widths, startResize };
}
function ResizeHandle({ onMouseDown }) {
  return <span onMouseDown={onMouseDown} onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 0, right: 0, width: 6, height: '100%', cursor: 'col-resize', userSelect: 'none' }} />;
}

function ListView({ deals, columns, sort, onSort, onOpen, today }) {
  const { widths, startResize } = useColWidths(columns);
  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <table style={{ borderCollapse: 'collapse', background: '#fff', fontSize: 13, tableLayout: 'fixed' }}>
        <thead><tr>
          <th style={{ ...th, width: 30 }}></th>
          {columns.map((k) => { const lbl = (LIST_FIELDS.find((f) => f[0] === k) || [k, k])[1]; const active = sort.key === k; return (
            <th key={k} onClick={() => onSort(k)} style={{ ...th, cursor: 'pointer', whiteSpace: 'nowrap', width: widths[k], position: 'relative', borderRight: `1px solid ${C.line}` }}>{lbl}{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}<ResizeHandle onMouseDown={(e) => startResize(k, e)} /></th>
          ); })}
        </tr></thead>
        <tbody>
          {deals.map((d) => { const stt = dealDotState(d, today); return (
            <tr key={d.id} onClick={() => onOpen(d.id)} style={{ cursor: 'pointer', borderBottom: `1px solid ${C.line}` }} onMouseEnter={(e) => (e.currentTarget.style.background = '#f7f9fb')} onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}>
              <td style={{ ...td, textAlign: 'center', borderRight: `1px solid ${C.faint}` }}>{stt && <Dot state={stt} size={13} />}</td>
              {columns.map((k) => <td key={k} style={{ ...td, width: widths[k], borderRight: `1px solid ${C.faint}` }}>{displayCell(d, k)}</td>)}
            </tr>
          ); })}
        </tbody>
      </table>
    </div>
  );
}

// ===========================================================================
// Companies / Contacts views (derived from deals)
// ===========================================================================
function EntityTable({ rows, fields, columns, sort, onSort }) {
  const { widths, startResize } = useColWidths(columns);
  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <table style={{ borderCollapse: 'collapse', background: '#fff', fontSize: 13, tableLayout: 'fixed' }}>
        <thead><tr>{columns.map((k) => { const lbl = (fields.find((f) => f[0] === k) || [k, k])[1]; const active = sort.key === k; return (
          <th key={k} onClick={() => onSort(k)} style={{ ...th, cursor: 'pointer', whiteSpace: 'nowrap', width: widths[k], position: 'relative', borderRight: `1px solid ${C.line}` }}>{lbl}{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}<ResizeHandle onMouseDown={(e) => startResize(k, e)} /></th>
        ); })}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${C.line}` }}>
              {columns.map((k) => <td key={k} style={{ ...td, width: widths[k], borderRight: `1px solid ${C.faint}` }}>{k === 'open_value' ? money0(r[k]) : (r[k] ?? '-')}</td>)}
            </tr>
          ))}
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
  const [deals, setDeals] = useState(() => SEED_DEALS.map((d) => ({ ...d, fields: { ...d.fields }, history: [...(d.history || [])], activities: [...(d.activities || [])] })));
  const [openId, setOpenId] = useState(null);
  const [view, setView] = useState('pipeline'); // pipeline | list | companies | contacts
  const [query, setQuery] = useState('');
  const [showSuggest, setShowSuggest] = useState(false);
  const [statusFilter, setStatusFilter] = useState('open');
  const [savedFilter, setSavedFilter] = useState(null);
  const [mcsnEstimator, setMcsnEstimator] = useState('all');
  const [customFilters, setCustomFilters] = useState([]);
  const [visibleStages, setVisibleStages] = useState(() => new Set(STAGES.map((s) => s.id)));
  const [stageMode, setStageMode] = useState('all');
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [companyCols, setCompanyCols] = useState(DEFAULT_COMPANY_COLUMNS);
  const [contactCols, setContactCols] = useState(DEFAULT_CONTACT_COLUMNS);
  const [chooser, setChooser] = useState(null); // 'list' | 'companies' | 'contacts'
  const [sort, setSort] = useState({ key: 'created', dir: 'desc' });
  const [entitySort, setEntitySort] = useState({ key: 'deals', dir: 'desc' });
  const [showAdd, setShowAdd] = useState(false);
  const [confetti, setConfetti] = useState(false);
  const [schema, setSchema] = useState(DEFAULT_FIELD_SCHEMA);
  const [showFieldMgr, setShowFieldMgr] = useState(false);
  const dragId = useRef(null);
  const nextId = useRef(900000);

  useEffect(() => { if (!router.isReady) return; const q = router.query.deal; if (q) setOpenId(Number(q)); }, [router.isReady, router.query.deal]);
  const openDealById = (id) => { setOpenId(id); router.push({ pathname: '/crm', query: { deal: id } }, undefined, { shallow: true }); };
  const closeDeal = () => { setOpenId(null); router.push('/crm', undefined, { shallow: true }); };
  useEffect(() => { setVisibleStages(new Set(stageMode === 'estimator' ? ESTIMATOR_STAGES : STAGES.map((s) => s.id))); }, [stageMode]);

  const statusOK = (d) => statusFilter === 'all' ? true : d.status === statusFilter;
  const savedOK = (d) => { if (savedFilter === 'tender') return ['stage_received','stage_1','stage_2','stage_review'].includes(d.stageId); if (savedFilter === 'mcsn') return ['stage_mc_secured','stage_negotiating'].includes(d.stageId); return true; };

  const filtered = useMemo(() => {
    let list = deals.filter(statusOK).filter(savedOK);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((d) => (d.title || '').toLowerCase().includes(q) || (d.fields.organization || '').toLowerCase().includes(q) || (d.fields.contact_person || '').toLowerCase().includes(q));
    customFilters.forEach((cf) => { if (cf.field && cf.value.trim()) { const cv = cf.value.trim().toLowerCase(); list = list.filter((d) => String(cellValue(d, cf.field)).toLowerCase().includes(cv)); } });
    return list;
  }, [deals, statusFilter, savedFilter, query, customFilters]);

  const mcsnEstimators = useMemo(() => { if (savedFilter !== 'mcsn') return []; const set = new Set(); filtered.forEach((d) => { const e = d.fields.estimator_responsible; if (e && String(e).trim()) set.add(String(e).trim()); }); return Array.from(set).sort(); }, [savedFilter, filtered]);
  const finalList = useMemo(() => { if (savedFilter === 'mcsn' && mcsnEstimator !== 'all') return filtered.filter((d) => String(d.fields.estimator_responsible || '') === mcsnEstimator); return filtered; }, [filtered, savedFilter, mcsnEstimator]);

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
    if (savedFilter === 'tender' && sort.key === 'created') { rows.sort((a, b) => { const ea = (a.fields.estimator_responsible || '').trim(), eb = (b.fields.estimator_responsible || '').trim(); if (!ea && eb) return -1; if (ea && !eb) return 1; return ea.localeCompare(eb); }); return rows; }
    const { key, dir } = sort;
    rows.sort((a, b) => { let av = cellValue(a, key), bv = cellValue(b, key); if (key === 'value' || key === 'size_m2' || key === 'credit_score') { av = Number(a.fields[key]) || 0; bv = Number(b.fields[key]) || 0; } if (av < bv) return dir === 'asc' ? -1 : 1; if (av > bv) return dir === 'asc' ? 1 : -1; return 0; });
    return rows;
  }, [finalList, sort, savedFilter]);

  // Companies & Contacts derived
  const companyRows = useMemo(() => {
    const m = {};
    deals.forEach((d) => { const o = d.fields.organization; if (!o) return; if (!m[o]) m[o] = { name: o, org_address: d.fields.org_address || '-', org_phone: d.fields.org_phone || '-', org_website: d.fields.org_website || '-', org_email: d.fields.org_email || '-', org_reg_number: d.fields.org_reg_number || '-', supply_chain_approved: d.fields.supply_chain_approved === true ? 'Yes' : d.fields.supply_chain_approved === false ? 'No' : '-', deals: 0, open_value: 0, won: 0, lost: 0 }; m[o].deals++; if (d.status === 'open') m[o].open_value += Number(d.fields.value) || 0; if (d.status === 'won') m[o].won++; if (d.status === 'lost') m[o].lost++; });
    let rows = Object.values(m);
    const q = query.trim().toLowerCase(); if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q));
    const { key, dir } = entitySort; rows.sort((a, b) => { const av = a[key], bv = b[key]; if (av < bv) return dir === 'asc' ? -1 : 1; if (av > bv) return dir === 'asc' ? 1 : -1; return 0; });
    return rows;
  }, [deals, query, entitySort]);

  const contactRows = useMemo(() => {
    const m = {};
    deals.forEach((d) => { const c = d.fields.contact_person; if (!c) return; const key = c + '|' + (d.fields.organization || ''); if (!m[key]) m[key] = { name: c, first_name: firstName(c) || '-', last_name: lastName(c) || '-', organization: d.fields.organization || '-', contact_phone: d.fields.contact_phone || '-', contact_email: d.fields.contact_email || '-', contact_job_role: d.fields.contact_job_role || '-', deals: 0, open_value: 0 }; m[key].deals++; if (d.status === 'open') m[key].open_value += Number(d.fields.value) || 0; });
    let rows = Object.values(m);
    const q = query.trim().toLowerCase(); if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || (r.organization || '').toLowerCase().includes(q));
    const { key, dir } = entitySort; rows.sort((a, b) => { const av = a[key], bv = b[key]; if (av < bv) return dir === 'asc' ? -1 : 1; if (av > bv) return dir === 'asc' ? 1 : -1; return 0; });
    return rows;
  }, [deals, query, entitySort]);

  const totalValue = finalList.filter((d) => d.status === 'open').reduce((s, d) => s + (Number(d.fields.value) || 0), 0);

  // mutations
  const patch = (id, fn) => setDeals((prev) => prev.map((d) => d.id === id ? fn(d) : d));
  const moveDeal = (id, stageId) => patch(id, (d) => d.stageId === stageId ? d : { ...d, stageId, history: [...d.history, { id: uid(), type: 'stage', ts: nowIso(), text: `Stage: ${stageLabel(d.stageId)} → ${stageLabel(stageId)}` }] });
  const setStatus = (id, status) => { patch(id, (d) => { const text = status === 'won' ? 'Deal marked Won' : status === 'lost' ? 'Deal marked Lost' : 'Deal reopened'; return { ...d, status, history: [...d.history, { id: uid(), type: status === 'open' ? 'note' : status, ts: nowIso(), text }] }; }); if (status === 'won') setConfetti(true); };
  const addNote = (id, body) => { const m = extractMentions(body); patch(id, (d) => { const ev = [{ id: uid(), type: 'note', ts: nowIso(), text: 'Note added', body, comments: [] }]; if (m.length) ev.push({ id: uid(), type: 'mention', ts: nowIso(), text: `Notified: ${m.join(', ')} (email would send in live version)` }); return { ...d, history: [...d.history, ...ev] }; }); };
  const commentNote = (id, hid, body) => patch(id, (d) => ({ ...d, history: d.history.map((h) => h.id === hid ? { ...h, comments: [...(h.comments || []), { id: uid(), body, ts: nowIso() }] } : h) }));
  const editHistory = (id, hid, body) => patch(id, (d) => ({ ...d, history: d.history.map((h) => h.id === hid ? { ...h, body, edited: true } : h) }));
  const editHistoryActivity = (id, hid, body, ts) => patch(id, (d) => ({ ...d, history: d.history.map((h) => h.id === hid ? { ...h, body, ts, edited: true } : h) }));
  const deleteHistory = (id, hid) => patch(id, (d) => ({ ...d, history: d.history.filter((h) => h.id !== hid) }));
  const reopenActivity = (id, hid) => patch(id, (d) => { const h = d.history.find((x) => x.id === hid); const text = h ? (h.body || h.text) : 'Activity'; return { ...d, activities: [...d.activities, { id: uid(), text, due: today, done: false }], history: [...d.history, { id: uid(), type: 'activity', ts: nowIso(), text: `Activity reopened: ${text}`, body: text }] }; });
  const addActivity = (id, text, due, assignee) => { const m = extractMentions(text); patch(id, (d) => { const a = { id: uid(), text, due, done: false, assignee: assignee || null, author: null }; const ev = [{ id: uid(), type: 'activity', ts: nowIso(), text: `Activity set: ${text} (due ${shortDate(due)})${assignee ? `, assigned to ${assignee}` : ''}`, body: text }]; if (assignee) ev.push({ id: uid(), type: 'mention', ts: nowIso(), text: `${assignee} assigned an activity — email would send in live version` }); if (m.length) ev.push({ id: uid(), type: 'mention', ts: nowIso(), text: `Notified: ${m.join(', ')} (email would send in live version)` }); return { ...d, activities: [...d.activities, a], history: [...d.history, ...ev] }; }); };
  const editActivity = (id, aid, text, due) => patch(id, (d) => ({ ...d, activities: d.activities.map((a) => a.id === aid ? { ...a, text, due } : a) }));
  const completeActivity = (id, aid) => { patch(id, (d) => { const act = d.activities.find((a) => a.id === aid); return { ...d, activities: d.activities.map((a) => a.id === aid ? { ...a, done: true } : a), history: [...d.history, { id: uid(), type: 'activity', ts: nowIso(), text: `Activity completed: ${act ? act.text : ''}`, body: act ? act.text : '' }] }; }); };
  const deleteActivity = (id, aid) => patch(id, (d) => ({ ...d, activities: d.activities.filter((a) => a.id !== aid) }));
  const editField = (id, key, val) => patch(id, (d) => {
    const old = d.fields[key];
    const hist = (key === 'value') ? [{ id: uid(), type: 'value', ts: nowIso(), text: `Value: ${money(old)} → ${money(val)}` }]
      : (key === 'expected_close_date') ? [{ id: uid(), type: 'close', ts: nowIso(), text: `Tender Return date: ${shortDate(old) || 'empty'} → ${shortDate(val) || 'empty'}` }]
      : [];
    const fields = { ...d.fields, [key]: val };
    // Maintain the person↔company link within the deal. When both a contact and a
    // company are present, record the link so it carries to the global record layer
    // at persistence. Changing the company updates where this contact "works".
    let link = d.link || null;
    if ((key === 'organization' || key === 'contact_person') && fields.contact_person && fields.organization) {
      link = { person: fields.contact_person, org: fields.organization, ts: nowIso() };
    }
    return { ...d, fields, link, history: [...d.history, ...hist] };
  });

  const createProject = (data) => {
    const id = nextId.current++;
    const fields = { value: Number(data.value) || 0, organization: data.organization || null, contact_person: data.contact_person || null, owner: null, created: nowIso().slice(0, 10), expected_close_date: data.expected_close_date || null, project_score: data.project_score || null };
    ['site_location','site_postcode','region','size_m2','credit_score','credit_limit','insured_credit_limit','glenigan_id','estimator_responsible','project_stage','roofing_works_onsite','sales_person','project_start_date','project_type','systems_priced','lead_source','scope_of_works','general_info','contact_phone','contact_email','contact_job_role','org_address','org_phone','org_website','org_email','org_reg_number','supply_chain_approved'].forEach((k) => { fields[k] = data[k] || null; });
    const link = (fields.contact_person && fields.organization) ? { person: fields.contact_person, org: fields.organization, ts: nowIso() } : null;
    const d = { id, title: data.title, stageId: data.stageId || 'stage_project_in', status: 'open', fields, link, activities: [], history: [{ id: uid(), type: 'note', ts: nowIso(), text: 'Project created' }] };
    setDeals((prev) => [d, ...prev]); setShowAdd(false); openDealById(id);
  };

  const addField = (f) => setSchema((prev) => [...prev, f]);
  const removeField = (key) => setSchema((prev) => prev.filter((f) => f.key !== key));
  const onDragStart = (e, id) => { dragId.current = id; };
  const onDrop = (e, stageId) => { const id = dragId.current; if (id != null) moveDeal(id, stageId); dragId.current = null; };
  const doSort = (key) => setSort((s) => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  const doEntitySort = (key) => setEntitySort((s) => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  const addCustomFilter = () => setCustomFilters((f) => [...f, { field: '', value: '' }]);
  const updateCustomFilter = (i, patch) => setCustomFilters((f) => f.map((cf, idx) => idx === i ? { ...cf, ...patch } : cf));
  const removeCustomFilter = (i) => setCustomFilters((f) => f.filter((_, idx) => idx !== i));

  const live = deals.find((d) => d.id === openId) || null;
  if (live) {
    return (
      <div style={{ fontFamily: FONT, color: C.text }}>
        <FontLoader />
        {confetti && <Confetti onDone={() => setConfetti(false)} />}
        {showFieldMgr && <FieldManager schema={schema} onClose={() => setShowFieldMgr(false)} onAdd={addField} onRemove={removeField} />}
        <DealView deal={live} today={today} schema={schema} onBack={closeDeal} onMove={moveDeal} onSetStatus={setStatus} onAddNote={addNote} onCommentNote={commentNote} onEditHistory={editHistory} onEditHistoryActivity={editHistoryActivity} onDeleteHistory={deleteHistory} onReopenActivity={reopenActivity} onAddActivity={addActivity} onEditActivity={editActivity} onCompleteActivity={completeActivity} onDeleteActivity={deleteActivity} onEditField={editField} onManageFields={() => setShowFieldMgr(true)} />
      </div>
    );
  }

  const isDealView = view === 'pipeline' || view === 'list';

  return (
    <div style={{ background: C.bg, height: '100vh', color: C.text, fontFamily: FONT, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <FontLoader />
      {confetti && <Confetti onDone={() => setConfetti(false)} />}
      {showFieldMgr && <FieldManager schema={schema} onClose={() => setShowFieldMgr(false)} onAdd={addField} onRemove={removeField} />}
      {chooser === 'list' && <ColumnChooser title="Choose columns" fields={LIST_FIELDS} columns={columns} onToggle={(k) => setColumns((p) => p.includes(k) ? p.filter((c) => c !== k) : [...p, k])} onClose={() => setChooser(null)} />}
      {chooser === 'companies' && <ColumnChooser title="Choose columns" fields={COMPANY_FIELDS} columns={companyCols} onToggle={(k) => setCompanyCols((p) => p.includes(k) ? p.filter((c) => c !== k) : [...p, k])} onClose={() => setChooser(null)} />}
      {chooser === 'contacts' && <ColumnChooser title="Choose columns" fields={CONTACT_FIELDS} columns={contactCols} onToggle={(k) => setContactCols((p) => p.includes(k) ? p.filter((c) => c !== k) : [...p, k])} onClose={() => setChooser(null)} />}

      {/* black nav with Rock Roofing logo */}
      <div style={{ background: C.nav, color: '#fff', padding: '10px 16px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: .3, marginRight: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ background: C.link, color: '#fff', borderRadius: 5, padding: '2px 7px', fontSize: 14, fontWeight: 800 }}>RR</span>Rock Roofing
        </span>
        <div style={{ display: 'flex', border: `1px solid #444`, borderRadius: 6, overflow: 'hidden' }}>
          <button onClick={() => setView('pipeline')} style={segBtn(view === 'pipeline')}>Pipeline</button>
          <button onClick={() => setView('list')} style={segBtn(view === 'list')}>List</button>
        </div>
        {/* Companies / Contacts buttons to the LEFT of search */}
        <button onClick={() => setView('companies')} style={{ ...backBtn, background: view === 'companies' ? C.link : 'transparent', color: '#fff', borderColor: view === 'companies' ? C.link : '#444' }}>Companies</button>
        <button onClick={() => setView('contacts')} style={{ ...backBtn, background: view === 'contacts' ? C.link : 'transparent', color: '#fff', borderColor: view === 'contacts' ? C.link : '#444' }}>Contacts</button>
        {isDealView && <button onClick={() => setShowAdd(true)} style={primaryBtn}>+ Add project</button>}
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative', minWidth: 260 }}>
          <input placeholder="Search…" value={query} onChange={(e) => { setQuery(e.target.value); setShowSuggest(true); }} onFocus={() => setShowSuggest(true)} onBlur={() => setTimeout(() => setShowSuggest(false), 150)} style={{ ...miniInput, width: '100%', boxSizing: 'border-box', paddingRight: 26 }} />
          {query && <span onClick={() => setQuery('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: C.dim, fontSize: 14 }}>✕</span>}
          {showSuggest && suggestions.length > 0 && isDealView && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 6, marginTop: 2, boxShadow: '0 4px 12px rgba(0,0,0,.15)', maxHeight: 260, overflowY: 'auto' }}>
              {suggestions.map((s, i) => <div key={i} onMouseDown={() => { if (s.id) openDealById(s.id); else setQuery(s.label); setShowSuggest(false); }} style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', borderBottom: `1px solid #f2f3f5`, display: 'flex', justifyContent: 'space-between', color: C.text }}><span>{s.label}</span><span style={{ fontSize: 11, color: C.dim }}>{s.type}</span></div>)}
            </div>
          )}
        </div>
        {isDealView && <span style={{ fontSize: 13, color: '#cfd6dd' }}>{finalList.length} deals · {money0(totalValue)} open</span>}
      </div>

      {/* filter bar (only for deal views) */}
      {isDealView && (
        <div style={{ background: C.card, borderBottom: `1px solid ${C.line}`, padding: '10px 16px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: C.dim }}>Status:</span>
            <div style={{ display: 'flex', gap: 4 }}>{['open','won','lost','all'].map((s) => <button key={s} onClick={() => setStatusFilter(s)} style={chip(statusFilter === s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}</div>
            <span style={sep} />
            <button onClick={() => { setSavedFilter(savedFilter === 'tender' ? null : 'tender'); setMcsnEstimator('all'); }} style={chip(savedFilter === 'tender')}>Tender Review List</button>
            <button onClick={() => { setSavedFilter(savedFilter === 'mcsn' ? null : 'mcsn'); setMcsnEstimator('all'); }} style={chip(savedFilter === 'mcsn')}>MC Secured &amp; Negotiating</button>
            {savedFilter === 'mcsn' && <select value={mcsnEstimator} onChange={(e) => setMcsnEstimator(e.target.value)} style={{ ...miniInput, width: 160 }}><option value="all">All estimators</option>{mcsnEstimators.map((e) => <option key={e} value={e}>{e}</option>)}</select>}
            <span style={sep} />
            {view === 'pipeline' && <div style={{ display: 'flex', border: `1px solid ${C.line}`, borderRadius: 16, overflow: 'hidden' }}><button onClick={() => setStageMode('all')} style={toggleBtn(stageMode === 'all')}>All Stages</button><button onClick={() => setStageMode('estimator')} style={toggleBtn(stageMode === 'estimator')}>Estimator Stages Only</button></div>}
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
          {/* Choose Columns — line below filters, far right, list view only */}
          {view === 'list' && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}><button onClick={() => setChooser('list')} style={ghostBtn}>Choose Columns</button></div>}
        </div>
      )}

      {/* Companies/Contacts: a thin bar with Choose Columns on the right */}
      {!isDealView && (
        <div style={{ background: C.card, borderBottom: `1px solid ${C.line}`, padding: '10px 16px', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{view === 'companies' ? `Companies (${companyRows.length})` : `Contacts (${contactRows.length})`}</span>
          <button onClick={() => setChooser(view)} style={ghostBtn}>Choose Columns</button>
        </div>
      )}

      {/* body */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: view === 'pipeline' ? '12px 12px 0' : 0 }}>
        {view === 'pipeline' && (
          <div style={{ display: 'flex', gap: 0, height: '100%', overflowX: 'auto', overflowY: 'hidden', minHeight: 0, paddingBottom: 12 }}>
            {shownStages.map((s, i) => <BoardColumn key={s.id} stage={s} deals={byStage[s.id] || []} onOpen={openDealById} onDragStart={onDragStart} onDrop={onDrop} today={today} isFirst={i === 0} />)}
          </div>
        )}
        {view === 'list' && <ListView deals={listRows} columns={columns} sort={sort} onSort={doSort} onOpen={openDealById} today={today} />}
        {view === 'companies' && <EntityTable rows={companyRows} fields={COMPANY_FIELDS} columns={companyCols} sort={entitySort} onSort={doEntitySort} />}
        {view === 'contacts' && <EntityTable rows={contactRows} fields={CONTACT_FIELDS} columns={contactCols} sort={entitySort} onSort={doEntitySort} />}
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
  const [showNewOrg, setShowNewOrg] = useState(false);
  const [showNewContact, setShowNewContact] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const schemaFor = (k) => DEFAULT_FIELD_SCHEMA.find((x) => x.key === k) || { key: k, type: 'text' };
  const systemsOpts = (schemaFor('systems_priced').options) || [];

  // Field groups (mirror the sidebar). Person/org detail fields live in their own sections.
  const PROJECT_FIELDS = [['title','Project title', true],['value','Value (£)', false],['project_score','Project Score', false],['expected_close_date','Tender Return date', false]];
  const DETAIL_KEYS = ['glenigan_id','site_location','region','size_m2','credit_score','credit_limit','insured_credit_limit','project_stage','roofing_works_onsite','estimator_responsible','scope_of_works','general_info','sales_person','project_start_date','project_type','lead_source'];
  const CONTACT_KEYS = [['contact_phone','Phone'],['contact_email','Email'],['contact_job_role','Job Role']];
  const ORG_KEYS = [['org_address','Address'],['org_phone','Phone'],['org_website','Website'],['org_email','Email'],['org_reg_number','Registration Number'],['supply_chain_approved','Supply Chain Approved?']];

  const renderInput = (k) => {
    const def = schemaFor(k);
    if (def.type === 'select') return <select value={f[k] || ''} onChange={(e) => set(k, e.target.value)} style={{ ...miniInput, width: '100%', boxSizing: 'border-box' }}><option value="">-</option>{(def.options || []).map((o) => <option key={o} value={o}>{o}</option>)}</select>;
    if (def.type === 'yesno') return <select value={f[k] || ''} onChange={(e) => set(k, e.target.value)} style={{ ...miniInput, width: '100%', boxSizing: 'border-box' }}><option value="">-</option><option>Yes</option><option>No</option></select>;
    if (def.type === 'date') return <input type="date" value={f[k] || ''} onChange={(e) => set(k, e.target.value)} style={{ ...miniInput, width: '100%', boxSizing: 'border-box' }} />;
    if (def.type === 'multiselect') return <MultiSelect value={f[k] || ''} onChange={(v) => set(k, v)} options={def.options || []} placeholder="Select…" />;
    return <input type={def.type === 'number' || def.type === 'currency' ? 'number' : 'text'} value={f[k] || ''} onChange={(e) => set(k, e.target.value)} style={{ ...miniInput, width: '100%', boxSizing: 'border-box' }} />;
  };
  const fieldCell = (k, lbl, req, full) => <div key={k} style={full ? { gridColumn: '1 / -1' } : {}}><label style={fLbl}>{lbl}{req ? ' *' : ''}</label>{renderInput(k)}</div>;

  const create = () => {
    if (!f.title || !f.title.trim()) { alert('Project title is required.'); return; }
    onCreate({ ...f, organization: org, contact_person: contact, stageId });
  };
  const grpHdr = { fontSize: 13, fontWeight: 700, margin: '18px 0 8px', paddingBottom: 6, borderBottom: `1px solid ${C.line}` };

  return (
    <div style={overlay}><div style={{ ...modal, maxWidth: 680 }}>
      <div style={modalHead}><span style={{ fontSize: 16, fontWeight: 700 }}>Add new project</span><button onClick={onClose} style={xBtn}>✕</button></div>
      <div style={{ padding: 20, overflowY: 'auto', maxHeight: '75vh' }}>

        {/* PROJECT */}
        <div style={{ ...grpHdr, marginTop: 0 }}>Project</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {fieldCell('title','Project title', true, true)}
          {fieldCell('value','Value (£)', false)}
          <div><label style={fLbl}>Stage</label><select value={stageId} onChange={(e) => setStageId(e.target.value)} style={{ ...miniInput, width: '100%', boxSizing: 'border-box' }}>{STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
          {fieldCell('project_score','Project Score', false)}
          {fieldCell('expected_close_date','Tender Return date', false)}
        </div>

        {/* DETAILS */}
        <div style={grpHdr}>Details</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {DETAIL_KEYS.map((k) => fieldCell(k, schemaFor(k).label || k, false, k === 'scope_of_works' || k === 'general_info'))}
          <div style={{ gridColumn: '1 / -1' }}><label style={fLbl}>Systems Priced</label><MultiSelect value={f.systems_priced || ''} onChange={(v) => set('systems_priced', v)} options={systemsOpts} placeholder="Select systems…" /></div>
        </div>

        {/* CUSTOMER CONTACT */}
        <div style={grpHdr}>Customer Contact</div>
        <label style={fLbl}>Search existing contact</label>
        <TypeAhead value={contact} onChange={setContact} options={CONTACTS} placeholder="Type to search contacts…" />
        <button onClick={() => setShowNewContact((v) => !v)} style={{ ...ghostBtn, marginTop: 8 }}>{showNewContact ? '− Cancel new contact' : '+ Add new customer contact'}</button>
        {showNewContact && (
          <div style={{ marginTop: 10, padding: 12, background: C.sideBox, borderRadius: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ gridColumn: '1 / -1' }}><label style={fLbl}>Full name</label><input value={contact} onChange={(e) => setContact(e.target.value)} style={{ ...miniInput, width: '100%', boxSizing: 'border-box' }} /></div>
              {CONTACT_KEYS.map(([k, lbl]) => fieldCell(k, lbl, false))}
            </div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>This contact will be linked to the company below.</div>
          </div>
        )}

        {/* ORGANIZATION */}
        <div style={grpHdr}>Organization</div>
        <label style={fLbl}>Search existing customer</label>
        <TypeAhead value={org} onChange={setOrg} options={ORGS} placeholder="Type to search customers…" />
        <button onClick={() => setShowNewOrg((v) => !v)} style={{ ...ghostBtn, marginTop: 8 }}>{showNewOrg ? '− Cancel new customer' : '+ Add new customer'}</button>
        {showNewOrg && (
          <div style={{ marginTop: 10, padding: 12, background: C.sideBox, borderRadius: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ gridColumn: '1 / -1' }}><label style={fLbl}>Company name</label><input value={org} onChange={(e) => setOrg(e.target.value)} style={{ ...miniInput, width: '100%', boxSizing: 'border-box' }} /></div>
              {ORG_KEYS.map(([k, lbl]) => fieldCell(k, lbl, false, k === 'org_address'))}
            </div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>The contact above will be linked to this company.</div>
          </div>
        )}
      </div>
      <div style={modalFoot}><button onClick={onClose} style={ghostBtn}>Cancel</button><button onClick={create} style={primaryBtn}>Create project</button></div>
    </div></div>
  );
}

// ---- styles ---------------------------------------------------------------
const pill = (color) => ({ fontSize: 10, fontWeight: 700, color: '#fff', background: color, padding: '1px 7px', borderRadius: 3 });
const segBtn = (active) => ({ background: active ? C.link : 'transparent', color: '#fff', border: 'none', padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' });
const toggleBtn = (active) => ({ background: active ? C.link : '#fff', color: active ? '#fff' : C.text, border: 'none', padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' });
const chip = (active) => ({ background: active ? '#e5effd' : '#fff', color: active ? C.link : C.text, border: `1px solid ${active ? C.link : C.line}`, borderRadius: 16, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' });
const sep = { width: 1, height: 22, background: C.line, margin: '0 4px', display: 'inline-block' };
const backBtn = { background: '#fff', border: `1px solid ${C.line}`, borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: C.text, fontWeight: 600 };
const wlBtn = { borderRadius: 6, padding: '6px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none' };
const primaryBtn = { background: C.link, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const ghostBtn = { background: '#fff', color: C.text, border: `1px solid ${C.line}`, borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const miniBtn = { background: C.link, color: '#fff', border: 'none', borderRadius: 5, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const miniInput = { border: `1px solid ${C.line}`, borderRadius: 6, padding: '7px 9px', fontSize: 13, color: C.text, outline: 'none', background: '#fff', fontFamily: 'inherit' };
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
