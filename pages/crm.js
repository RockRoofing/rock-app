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

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import * as XLSX from 'xlsx';
import { mapPipedriveRows, mapOrganizationRows, mapPeopleRows, mapActivityRows, mapNoteRows, groupByDeal, detectExportType } from '../lib/crmImportMap';
import { SEED_DEALS } from '../lib/crmSeedDeals';
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
// Local-date YYYY-MM-DD. Deliberately NOT toISOString(), which converts to UTC and would
// show the previous day for anyone in BST during the evening.
const todayISO = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// ---------------------------------------------------------------------------
// Remembered view preferences - which tab you were on, your filters, your chosen
// columns and your sort order. Stored in this browser, so it survives a refresh or
// closing the tab and picks up exactly where you left off.
//
// Kept out of the database on purpose: these are per-person display choices, they
// change constantly, and writing them server-side would mean a save on every click.
// The trade-off is that they do not follow you to a different computer.
//
// The version suffix means that if the shape ever changes, old saved preferences are
// ignored rather than restored into fields that no longer exist.
// ---------------------------------------------------------------------------
const PREFS_KEY = 'crm:prefs:v1';

function loadPrefs() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return (p && typeof p === 'object') ? p : null;
  } catch { return null; }
}

function savePrefs(prefs) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode / full quota */ }
}

// The form a deal is SAVED in: imported activities/notes belong to their own per-deal
// stores, and the kanban summaries are in-memory only. The baseline used for "what
// changed" must be built with this same function, or every deal looks different from its
// stored copy and the whole list gets resent.
const leanDeal = (d) => {
  const { _actSummary, _noteSummary, ...rest } = d;
  return {
    ...rest,
    // ONE STORE. No activities or notes on the deal - imported and CRM-created alike all
    // live in crm:activities:<dealId> / crm:notes:<dealId>. They are sent WITH this deal in
    // the same request (see __activities / __notes below) and the server files them, so
    // they cannot be stored without each other.
    activities: [],
    notes: [],
    // History keeps everything except the injected copies of IMPORTED notes/activities.
    history: (d.history || []).filter((h) => !String(h.id || '').startsWith('h_pd_')),
  };
};

// Resolve a name written anywhere - Pipedrive's "James McVeigh", the old CRM's "James" -
// to the matching PORTAL USER, which is the source of truth.
//
// Matching, in order:
//   1. exact, ignoring case      "james mcveigh" -> James McVeigh
//   2. unique first name         "James"         -> James McVeigh
//   3. unique last name          "McVeigh"       -> James McVeigh
//
// A first name shared by two portal users is NOT merged - guessing which of two people was
// meant would be worse than leaving it alone.
function buildNameResolver(users) {
  const list = (users || []).filter((u) => u.name);
  const exact = new Map();
  const byFirst = new Map();
  const byLast = new Map();
  for (const u of list) {
    exact.set(u.name.trim().toLowerCase(), u.name);
    const parts = u.name.trim().split(/\s+/);
    const first = (u.first || parts[0] || '').toLowerCase();
    const last = (parts.length > 1 ? parts[parts.length - 1] : '').toLowerCase();
    if (first) byFirst.set(first, byFirst.has(first) ? null : u.name);   // null = ambiguous
    if (last) byLast.set(last, byLast.has(last) ? null : u.name);
  }
  return (raw) => {
    const t = String(raw == null ? '' : raw).trim();
    if (!t) return '';
    const k = t.toLowerCase();
    if (exact.has(k)) return exact.get(k);
    if (byFirst.get(k)) return byFirst.get(k);
    if (byLast.get(k)) return byLast.get(k);
    return t;    // unknown name - shown as written rather than silently dropped
  };
}

// The activities this deal owns that were created in the CRM (not imported).
const crmActivities = (d) => (d.activities || []).filter((a) => !a.imported);

// Notes written in the CRM. They live in the history as type 'note'; imported ones are
// injected with an h_pd_ id and belong to the store already.
const crmNotes = (d) => (d.history || [])
  .filter((h) => h.type === 'note' && !String(h.id || '').startsWith('h_pd_'))
  .map((h) => ({ id: h.id, body: h.body || h.text || '', ts: h.ts || null, author: h.author || null, comments: h.comments || [], edited: !!h.edited }));

const uid = () => 'x' + Math.random().toString(36).slice(2, 9);
// Pipedrive note content comes through as HTML. The CRM's note boxes render plain text,
// so convert rather than showing raw tags: breaks become newlines, entities decoded.
const stripHtml = (h) => String(h == null ? '' : h)
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/p>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/\n{3,}/g, '\n\n')
  .trim();
const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

// dot state: warning=none, red=before today, green=today, grey=after today
//
// Imported activities are NOT held on the deal - 36k of them in crm:deals measured 31MB,
// far too big to load on every page open. They live per deal and load when a deal is
// opened. So the board falls back to the lightweight summary (_actSummary) the import
// writes: how many are still open, and the earliest due date among them.
function dealDotState(deal, today) {
  if (deal.status !== 'open') return null;
  const open = (deal.activities || []).filter((a) => !a.done);
  if (open.length) {
    if (open.some((a) => a.due < today)) return 'overdue';
    if (open.some((a) => a.due === today)) return 'today';
    return 'future';
  }
  const sum = deal._actSummary;
  if (sum && sum.open > 0) {
    if (sum.next && sum.next < today) return 'overdue';
    if (sum.next === today) return 'today';
    return 'future';
  }
  return 'none';
}
function nextActivityDate(deal) {
  const open = (deal.activities || []).filter((a) => !a.done);
  if (open.length) return open.map((a) => a.due).sort()[0];
  return (deal._actSummary && deal._actSummary.next) || '';
}
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
      <div style={{ marginTop: 4, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 6, padding: '4px 8px' }}>
        <MentionInput value={text} onChange={setText} placeholder="Add a comment… (type @ to notify someone)" rows={1} />
        <div style={{ textAlign: 'right' }}>
          <button disabled={!text.trim()} onClick={() => { onAdd(text.trim()); setText(''); }} style={{ ...miniBtn, opacity: text.trim() ? 1 : 0.5 }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Board card + CHEVRON column
// ===========================================================================
function BoardCard({ deal, onOpen, onDragStart, today }) {
  const st = dealDotState(deal, today);
  // A tender return with nobody responsible for it is the thing most likely to be missed,
  // so it is flagged on the card rather than only being visible inside the deal.
  const needsEstimator = !deal.fields?.estimator_responsible
    && ((deal.activities || []).some((a) => a.text === 'Tender return' && !a.done) || !!deal.fields?.expected_close_date);
  // Same idea for Negotiating: the four handover tasks are worthless if nobody owns them.
  const needsSalesPerson = deal.stageId === 'stage_negotiating' && !deal.fields?.sales_person;
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
      {needsEstimator && (
        <div title="Tender return with no estimator responsible"
          style={{ marginTop: 6, background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', borderRadius: 5, padding: '3px 6px', fontSize: 10.5, fontWeight: 700 }}>
          &#9888; No estimator assigned
        </div>
      )}
      {needsSalesPerson && (
        <div title="In Negotiating with no sales person - the handover tasks have nobody responsible"
          style={{ marginTop: 6, background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', borderRadius: 5, padding: '3px 6px', fontSize: 10.5, fontWeight: 700 }}>
          &#9888; No sales person assigned
        </div>
      )}
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
function EditableField({ field, value, onSave, users }) {
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
      {field.type === 'select' && (() => {
        const opts = field.fromPortalUsers ? (users || []).map((u) => u.name) : (field.options || []);
        // Keep a stored value that is not on the list. Imported data has 110 distinct
        // lost reasons, most of them one-off free text; without this the select would
        // render blank and look as though the value had been lost.
        const cur = cp.value == null ? '' : String(cp.value);
        const all = (cur && !opts.includes(cur)) ? [...opts, cur] : opts;
        return <select {...cp}><option value="">-</option>{all.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
      })()}
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
function ActivityRow({ activity, onEdit, onComplete, onDelete, overdue, me, users }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(activity.text);
  const [due, setDue] = useState(activity.due);
  const [assignee, setAssignee] = useState(activity.assignee || '');
  const people = ['', ...(me?.name ? [me.name] : []), ...(users || []).map((u) => u.name).filter((n) => n !== me?.name)];
  return (
    <div style={{ border: `1px solid ${overdue ? C.red : C.activityBorder}`, background: '#fff', borderRadius: 6, padding: 10, marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: .4, marginBottom: 4 }}>
        Activity{activity.assignee
          ? <span style={{ textTransform: 'none', fontWeight: 600, color: C.link }}> &middot; {activity.assignee}</span>
          : <span style={{ textTransform: 'none', fontWeight: 400, color: '#bbb' }}> &middot; nobody assigned</span>}
      </div>
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input value={text} onChange={(e) => setText(e.target.value)} style={miniInput} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ ...miniInput, width: 150 }} />
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} style={{ ...miniInput, width: 150 }} title="Person responsible">
              {people.map((n) => <option key={n || 'none'} value={n}>{n ? (n === me?.name ? `${n} (you)` : n) : 'Nobody'}</option>)}
            </select>
            <button onClick={() => { onEdit(activity.id, text || 'Call', due, assignee); setEditing(false); }} style={miniBtn}>Save</button>
            <button onClick={() => setEditing(false)} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div>
            <div style={{ fontSize: 14 }}>{activity.text}</div>
            <div style={{ fontSize: 12, color: overdue ? C.red : C.dim, marginTop: 2 }}>Due {shortDate(activity.due)}{overdue ? ' · OVERDUE' : ''} · Assigned to {activity.assignee || 'nobody'}</div>
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
// Copy to clipboard
// ===========================================================================
// One component for every copy button, so they all behave the same way and all confirm
// they worked. navigator.clipboard is missing on some older mobile browsers and refuses
// to run outside a secure context, so there is a textarea fallback behind it.
function copyText(s) {
  const text = String(s == null ? '' : s);
  try {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return Promise.resolve();
  } catch { return Promise.reject(new Error('copy failed')); }
}

function CopyButton({ text, title, style, children, copiedLabel = 'Copied' }) {
  const [state, setState] = useState('');   // '' | 'ok' | 'fail'
  useEffect(() => { if (!state) return; const t = setTimeout(() => setState(''), 1400); return () => clearTimeout(t); }, [state]);
  return (
    <button
      onClick={() => copyText(text).then(() => setState('ok')).catch(() => setState('fail'))}
      title={title}
      style={{ ...style, cursor: 'pointer', position: 'relative' }}>
      {children}
      {state && (
        <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: state === 'ok' ? C.green : C.lost }}>
          {state === 'ok' ? copiedLabel : 'Copy failed'}
        </span>
      )}
    </button>
  );
}

// ===========================================================================
// Email (Outlook sync)
// ===========================================================================
// These are all MODULE-SCOPE components with their own hooks, deliberately. Nothing here
// adds a hook to CRMPageInner, which is where the early `if (live) return` sits - putting
// a hook below that line is what threw React error #300 before.

const emailPerson = (addr, name) => {
  const a = String(addr || '').trim();
  const n = String(name || '').trim();
  if (n && a && n.toLowerCase() !== a.toLowerCase()) return `${n} <${a}>`;
  return a || n || 'Unknown sender';
};

// Who it went to, trimmed - a circulation list of fifteen people is noise in a history.
function recipientLine(m) {
  const all = [...(m.to || []), ...(m.cc || [])].filter(Boolean);
  if (!all.length) return '';
  if (all.length <= 3) return `To: ${all.join(', ')}`;
  return `To: ${all.slice(0, 3).join(', ')} +${all.length - 3} more`;
}

function EmailCard({ m, children }) {
  const [open, setOpen] = useState(false);
  const preview = String(m.preview || '').trim();
  const long = preview.length > 180;
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 8, padding: 10, marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, minWidth: 0, wordBreak: 'break-word' }}>{m.subject || '(no subject)'}</div>
        <div style={{ fontSize: 11, color: C.dim, whiteSpace: 'nowrap' }}>{dateTime(m.date)}</div>
      </div>
      <div style={{ fontSize: 12, color: C.dim, marginTop: 3 }}>{emailPerson(m.from, m.fromName)}</div>
      {recipientLine(m) && <div style={{ fontSize: 11, color: C.dim, marginTop: 2, wordBreak: 'break-word' }}>{recipientLine(m)}</div>}
      {preview && (
        <div style={{ fontSize: 12.5, color: C.text, marginTop: 6, whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>
          {open || !long ? preview : preview.slice(0, 180) + '\u2026'}
          {long && <button onClick={() => setOpen((v) => !v)} style={{ background: 'none', border: 'none', color: C.link, fontSize: 12, cursor: 'pointer', padding: '0 4px', fontFamily: 'inherit' }}>{open ? 'less' : 'more'}</button>}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {m.webLink && <a href={m.webLink} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: C.link, fontWeight: 600, textDecoration: 'none' }}>Open in Outlook &rarr;</a>}
        {m.mailbox && <span style={{ fontSize: 10.5, color: C.dim, background: C.faint, borderRadius: 3, padding: '2px 6px' }}>{m.mailbox}</span>}
        {m.matchedBy && <span style={{ fontSize: 10.5, color: C.dim, background: C.faint, borderRadius: 3, padding: '2px 6px' }}>matched by {m.matchedBy}</span>}
        {children}
      </div>
    </div>
  );
}

// Emails filed against one project. Loads its own data - the deals list is already 6.4MB
// and email must not ride along with it.
function DealEmails({ dealId, deals }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [moveFor, setMoveFor] = useState(null);

  useEffect(() => {
    let dead = false;
    setLoading(true); setErr('');
    fetch('/api/crm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'emails', dealId: String(dealId) }),
    })
      .then((r) => r.json())
      .then((d) => { if (dead) return; if (d && d.ok) setItems(d.items || []); else setErr(d?.error || 'Could not load email'); })
      .catch(() => { if (!dead) setErr('Could not load email'); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [dealId]);

  // Filed against the WRONG project - far commoner than an email that should not be on a
  // project at all. It gets its own action because Remove is not a route to the same
  // place: removing does not put the email back in the queue for you to re-file.
  const move = async (m, target) => {
    const before = items;
    setMoveFor(null); setNote('');
    setItems((prev) => prev.filter((x) => x.id !== m.id));
    try {
      const d = await fetch('/api/crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move-email', messageId: m.id, fromDealId: String(dealId), toDealId: String(target.id) }),
      }).then((r) => r.json());
      if (!d || !d.ok) throw new Error(d?.error || 'Failed');
      setNote(`Moved to ${target.title || target.id}.`);
    } catch (e) {
      setItems(before);
      setNote(`That did not save - the email has been put back. ${e.message || ''}`.trim());
    }
  };

  // Should not be on a project at all. Removing also tells the sync to leave it alone -
  // without that it would simply be re-filed on the next run and the removal would look
  // like it had not worked.
  const unfile = async (m) => {
    const ok = window.confirm('Take this email off the project?\n\nIt stays in Outlook. The sync will not file it again, here or anywhere else, until you undo it.\n\nIf it simply belongs on a DIFFERENT project, use Move instead.');
    if (!ok) return;
    const before = items;
    setItems((prev) => prev.filter((x) => x.id !== m.id));
    setNote('');
    try {
      const d = await fetch('/api/crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unfile-email', messageId: m.id, dealId: String(dealId) }),
      }).then((r) => r.json());
      if (!d || !d.ok) throw new Error(d?.error || 'Failed');
      setNote('Removed.');
    } catch {
      setItems(before);
      setNote('That did not save - the email has been put back.');
    }
  };

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Email</div>
      <div style={{ fontSize: 11, color: C.dim, marginBottom: 8 }}>
        Filed automatically from the synced mailboxes. To file one by hand, BCC crm@rockroofing.co.uk with <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>[CRM-{dealId}]</span> in the subject.
      </div>
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: 12 }}>
        {note && <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 8 }}>{note}</div>}
        {loading && <div style={{ fontSize: 13, color: C.dim }}>Loading&#8230;</div>}
        {!loading && err && <div style={{ fontSize: 13, color: C.lost }}>{err}</div>}
        {!loading && !err && !items.length && <div style={{ fontSize: 13, color: C.dim }}>No email filed against this project yet.</div>}
        {!loading && !err && items.map((m) => (
          <div key={m.id}>
            <EmailCard m={m}>
              <div style={{ flex: 1 }} />
              <button onClick={() => setMoveFor((v) => v === m.id ? null : m.id)} title="File this email against a different project" style={{ background: 'none', border: 'none', color: C.link, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Move</button>
              <button onClick={() => unfile(m)} title="Take this email off the project altogether" style={{ background: 'none', border: 'none', color: C.dim, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Remove</button>
            </EmailCard>
            {moveFor === m.id && (
              <div style={{ marginTop: -4, marginBottom: 10 }}>
                <ProjectPicker deals={(deals || []).filter((d) => String(d.id) !== String(dealId))} onPick={(d) => move(m, d)} onCancel={() => setMoveFor(null)} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Pick a project for an email that could not be matched. Searches title, company and
// contact, because you will remember any one of the three.
function ProjectPicker({ deals, onPick, onCancel }) {
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    const open = (deals || []).filter((d) => d.status === 'open');
    if (!s) return open.slice(0, 25);
    return open.filter((d) => (
      String(d.title || '').toLowerCase().includes(s)
      || String(d.fields?.organization || '').toLowerCase().includes(s)
      || String(d.fields?.contact_person || '').toLowerCase().includes(s)
      || String(d.id) === s
    )).slice(0, 25);
  }, [q, deals]);

  return (
    <div style={{ marginTop: 8, border: `1px solid ${C.link}`, borderRadius: 8, padding: 10, background: C.activityBg }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input autoFocus placeholder="Search open projects&#8230;" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...miniInput, flex: 1 }} />
        <button onClick={onCancel} style={ghostBtn}>Cancel</button>
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 8, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 6 }}>
        {!matches.length && <div style={{ fontSize: 12.5, color: C.dim, padding: 10 }}>No open project matches that.</div>}
        {matches.map((d) => (
          <div key={d.id} onClick={() => onPick(d)} style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', borderBottom: `1px solid ${C.faint}`, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{d.title || '(untitled)'}</span>
            <span style={{ fontSize: 11, color: C.dim, whiteSpace: 'nowrap' }}>{d.fields?.organization || ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// The review queue. Everything the sync could not place, newest first.
function EmailQueue({ deals, onOpenDeal }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [noteDeal, setNoteDeal] = useState(null);
  const [noteUndo, setNoteUndo] = useState('');
  const [search, setSearch] = useState('');
  const [pickerFor, setPickerFor] = useState(null);
  const [busy, setBusy] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const [bulkPicker, setBulkPicker] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const d = await fetch('/api/crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'emails-unallocated' }),
      }).then((r) => r.json());
      if (d && d.ok) setItems(d.items || []);
      else setErr(d?.error || 'Could not load the queue');
    } catch { setErr('Could not load the queue'); }
    setSel(new Set());          // ids may be gone after a reload
    setBulkPicker(false);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Optimistic, with the row put back if the write fails - the same pattern the
  // Activities tab uses for mark-done.
  const act = async (m, payload, doneMsg, deal, undoId) => {
    setBusy(m.id); setPickerFor(null); setNote(''); setNoteDeal(null); setNoteUndo('');
    const before = items;
    setItems((prev) => prev.filter((x) => x.id !== m.id));
    try {
      const d = await fetch('/api/crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => r.json());
      if (!d || !d.ok) throw new Error(d?.error || 'Failed');
      setNote(doneMsg); setNoteDeal(deal || null); setNoteUndo(undoId || '');
    } catch (e) {
      setItems(before);
      setNote(`That did not save - the email has been put back. ${e.message || ''}`.trim());
    }
    setBusy('');
  };

  const allocate = (m, deal) => act(m, { action: 'allocate-email', messageId: m.id, dealId: String(deal.id) }, `Filed against ${deal.title || deal.id}.`, deal);
  const dismiss = (m) => {
    const ok = window.confirm('Do not assign this email to a project?\n\nIt stays in Outlook untouched. The sync will leave it alone from now on, so it will not come back to this queue.');
    if (!ok) return;
    act(m, { action: 'dismiss-email', messageId: m.id }, 'Marked do not assign.', null, m.id);
  };

  // BULK ACTIONS
  // Select-all ticks what is CURRENTLY SHOWN, not the whole queue. If you have searched
  // for "Nishkam" and tick the box, you get the Nishkam ones - acting on 700 hidden rows
  // because a filter was on is how people lose things.
  const toggleOne = (id) => setSel((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const bulkDismiss = async () => {
    const ids = [...sel];
    if (!ids.length) return;
    const ok = window.confirm(`Do not assign ${ids.length} email${ids.length === 1 ? '' : 's'} to a project?\n\nThey stay in Outlook untouched. The sync will leave them alone from now on, so they will not come back to this queue.\n\nThere is no undo for a bulk action.`);
    if (!ok) return;
    setBulkBusy(true); setNote(''); setNoteDeal(null); setNoteUndo('');
    const before = items;
    setItems((prev) => prev.filter((x) => !sel.has(x.id)));
    try {
      const d = await fetch('/api/crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss-emails', messageIds: ids }),
      }).then((r) => r.json());
      if (!d || !d.ok) throw new Error(d?.error || 'Failed');
      setNote(`Marked do not assign: ${d.count}.`);
      setSel(new Set());
    } catch (e) {
      setItems(before);
      setNote(`That did not save - nothing was changed. ${e.message || ''}`.trim());
    }
    setBulkBusy(false);
  };

  const bulkAllocate = async (deal) => {
    const ids = [...sel];
    if (!ids.length) return;
    setBulkBusy(true); setBulkPicker(false); setNote(''); setNoteUndo('');
    const before = items;
    setItems((prev) => prev.filter((x) => !sel.has(x.id)));
    try {
      const d = await fetch('/api/crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'allocate-emails', messageIds: ids, dealId: String(deal.id) }),
      }).then((r) => r.json());
      if (!d || !d.ok) throw new Error(d?.error || 'Failed');
      setNote(`Filed ${d.count} against ${deal.title || deal.id}.`);
      setNoteDeal(deal);
      setSel(new Set());
    } catch (e) {
      setItems(before);
      setNote(`That did not save - nothing was changed. ${e.message || ''}`.trim());
    }
    setBulkBusy(false);
  };

  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return items;
    return items.filter((m) => `${m.subject} ${m.from} ${m.fromName} ${m.preview} ${m.mailbox}`.toLowerCase().includes(s));
  }, [items, search]);

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 16, boxSizing: 'border-box', background: C.feedBg }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Email review queue ({items.length})</span>
          <div style={{ flex: 1 }} />
          <input placeholder="Search&#8230;" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...miniInput, width: 220 }} />
          <button onClick={load} style={ghostBtn}>Refresh</button>
        </div>
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 12 }}>
          Mail the sync could not place against a project on its own. File it here, or dismiss it. Nothing is deleted from Outlook either way.
        </div>

        {note && (
          <div style={{ fontSize: 13, padding: '8px 11px', borderRadius: 8, background: C.mention, color: C.text, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>{note}</span>
            {noteDeal && onOpenDeal && <button onClick={() => onOpenDeal(noteDeal.id)} style={{ background: 'none', border: 'none', color: C.link, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>Open project &rarr;</button>}
            {noteUndo && (
              <button
                onClick={async () => {
                  const id = noteUndo;
                  setNoteUndo('');
                  try {
                    await fetch('/api/crm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'allow-email-again', messageId: id }) });
                    setNote('Undone. It will be picked up again on the next sync.');
                  } catch { setNote('Could not undo that.'); }
                }}
                style={{ background: 'none', border: 'none', color: C.link, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>Undo</button>
            )}
          </div>
        )}
        {loading && <div style={{ fontSize: 13, color: C.dim }}>Loading&#8230;</div>}
        {!loading && err && <div style={{ fontSize: 13, color: C.lost }}>{err}</div>}
        {!loading && !err && !items.length && <div style={{ fontSize: 13, color: C.dim }}>Nothing waiting. Every synced email has found a project.</div>}
        {!loading && !err && !!items.length && !shown.length && <div style={{ fontSize: 13, color: C.dim }}>Nothing matches that search.</div>}

        {/* Select-all bar. Acts on what is SHOWN, so a search narrows what you are about
            to act on rather than being quietly ignored. */}
        {!loading && !err && !!shown.length && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 11px', marginBottom: 8, borderRadius: 8, background: sel.size ? C.activityBg : C.faint, border: `1px solid ${sel.size ? C.activityBorder : C.line}` }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer', color: C.text }}>
              <input
                type="checkbox"
                checked={shown.length > 0 && shown.every((m) => sel.has(m.id))}
                ref={(el) => { if (el) el.indeterminate = sel.size > 0 && !shown.every((m) => sel.has(m.id)); }}
                onChange={(e) => {
                  const ids = shown.map((m) => m.id);
                  setSel((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) ids.forEach((id) => next.add(id));
                    else ids.forEach((id) => next.delete(id));
                    return next;
                  });
                }}
                style={{ width: 15, height: 15, cursor: 'pointer' }} />
              Select all {search.trim() ? `${shown.length} shown` : `${shown.length}`}
            </label>

            {sel.size > 0 && <>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>{sel.size} selected</span>
              <div style={{ flex: 1 }} />
              <button disabled={bulkBusy} onClick={() => setBulkPicker((v) => !v)} style={{ ...primaryBtn, opacity: bulkBusy ? 0.5 : 1 }}>Allocate to project</button>
              <button disabled={bulkBusy} onClick={bulkDismiss} style={{ ...ghostBtn, color: C.dim, opacity: bulkBusy ? 0.5 : 1 }}>Do not assign</button>
              <button disabled={bulkBusy} onClick={() => { setSel(new Set()); setBulkPicker(false); }} style={{ ...ghostBtn, color: C.dim }}>Clear</button>
            </>}
          </div>
        )}

        {bulkPicker && sel.size > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 6 }}>File all {sel.size} against:</div>
            <ProjectPicker deals={deals} onPick={bulkAllocate} onCancel={() => setBulkPicker(false)} />
          </div>
        )}

        {!loading && !err && shown.map((m) => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
            <input
              type="checkbox"
              checked={sel.has(m.id)}
              onChange={() => toggleOne(m.id)}
              title="Select for a bulk action"
              style={{ width: 15, height: 15, marginTop: 14, cursor: 'pointer', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
            <EmailCard m={m}>
              <div style={{ flex: 1 }} />
              <button disabled={busy === m.id} onClick={() => setPickerFor((v) => v === m.id ? null : m.id)} style={{ ...primaryBtn, opacity: busy === m.id ? 0.5 : 1 }}>Allocate to project</button>
              <button disabled={busy === m.id} onClick={() => dismiss(m)} style={{ ...ghostBtn, color: C.dim }}>Do not assign</button>
            </EmailCard>
            {m.suggestTitle && pickerFor !== m.id && (
              <div style={{ margin: '-4px 0 10px', padding: '8px 11px', background: C.activityBg, border: `1px solid ${C.activityBorder}`, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, color: C.text }}>
                  Looks like <strong>{m.suggestTitle}</strong> <span style={{ color: C.dim }}>({m.suggestScore}%{m.suggestRunnerUp ? `, next closest ${m.suggestRunnerUp}` : ''})</span>
                </span>
                <div style={{ flex: 1 }} />
                <button disabled={busy === m.id} onClick={() => allocate(m, { id: m.suggestDealId, title: m.suggestTitle })} style={{ ...primaryBtn, padding: '5px 12px' }}>Accept</button>
              </div>
            )}
            {pickerFor === m.id && (
              <div style={{ marginTop: -4, marginBottom: 10 }}>
                <ProjectPicker deals={deals} onPick={(d) => allocate(m, d)} onCancel={() => setPickerFor(null)} />
              </div>
            )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Nav button carrying the queue count. Its own component so the count can poll without
// a hook anywhere near CRMPageInner's early return. refreshKey re-counts when you leave
// the tab, so allocating something updates the badge.
function EmailsNavButton({ active, onClick, refreshKey }) {
  const [count, setCount] = useState(null);
  useEffect(() => {
    let dead = false;
    const tick = () => {
      if (document.hidden) return;
      fetch('/api/crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'emails-queue-count' }),
      })
        .then((r) => r.json())
        .then((d) => { if (!dead && d && d.ok) setCount(d.count); })
        .catch(() => {});
    };
    tick();
    const t = setInterval(tick, 60 * 1000);
    return () => { dead = true; clearInterval(t); };
  }, [refreshKey]);

  return (
    <button onClick={onClick} style={{ ...backBtn, background: active ? C.link : 'transparent', color: '#fff', borderColor: active ? C.link : '#444', display: 'flex', alignItems: 'center', gap: 6 }}>
      Emails
      {count > 0 && <span style={{ background: C.amber, color: '#1c1c1c', borderRadius: 9, fontSize: 11, fontWeight: 800, padding: '1px 6px' }}>{count}</span>}
    </button>
  );
}

// Asks why, before marking a deal Lost. Not optional dressing: the Sales dashboard's
// Lost Reasons panel is only as good as what gets recorded here, and a field nobody is
// prompted for is a field nobody fills in.
function LostReasonModal({ schema, onCancel, onConfirm }) {
  const options = (schema || []).find((f) => f.key === 'lost_reason')?.options || [];
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const chosen = reason === '__other' ? other.trim() : reason;

  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, padding: 20, width: 'min(460px, 92vw)', maxHeight: '86vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Why was this lost?</div>
        <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 14 }}>Feeds the Lost Reasons analysis on the Sales dashboard.</div>

        <select value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...miniInput, width: '100%', marginBottom: 10 }}>
          <option value="">Choose a reason&#8230;</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
          <option value="__other">Something else&#8230;</option>
        </select>

        {reason === '__other' && (
          <input autoFocus value={other} onChange={(e) => setOther(e.target.value)} placeholder="In your own words"
            style={{ ...miniInput, width: '100%', marginBottom: 10 }} />
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
          <button onClick={onCancel} style={ghostBtn}>Cancel</button>
          {/* Skipping is allowed - blocking someone from closing a deal because a
              dropdown is empty would just teach them to pick anything. */}
          <button onClick={() => onConfirm('')} style={{ ...ghostBtn, color: C.dim }}>Mark lost without a reason</button>
          <button disabled={!chosen} onClick={() => onConfirm(chosen)}
            style={{ ...primaryBtn, background: C.lost, opacity: chosen ? 1 : 0.45 }}>Mark lost</button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Deal view
// ===========================================================================
function DealView({ deal, allDeals, today, schema, me, users, onSetLostReason, onBack, onMove, onSetStatus, onAddNote, onCommentNote, onEditHistory, onEditHistoryActivity, onDeleteHistory, onReopenActivity, onAddActivity, onEditActivity, onCompleteActivity, onDeleteActivity, onEditField, onManageFields, onDeleteDeal }) {
  const [noteText, setNoteText] = useState('');
  const [lostFor, setLostFor] = useState(null);   // deal id awaiting a lost reason
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState('');
  const [newDue, setNewDue] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  // Default the new activity to whoever is logged in - the common case by far.
  useEffect(() => { if (me?.name) setNewAssignee((v) => v || me.name); }, [me]);
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
          <CopyButton
            text={deal.title || ''}
            title="Click to copy the project title"
            copiedLabel="Copied"
            style={{ background: 'transparent', border: '1px solid transparent', color: '#fff', fontSize: 17, fontWeight: 700, fontFamily: 'inherit', padding: '2px 8px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left' }}>
            {deal.title}
            <span style={{ fontSize: 11, color: '#8a8a8a', fontWeight: 600 }}>copy</span>
          </CopyButton>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => onSetStatus(deal.id, 'won')} style={{ ...wlBtn, background: C.won, color: '#fff' }}>Won</button>
          <button onClick={() => setLostFor(deal.id)} style={{ ...wlBtn, background: C.lost, color: '#fff' }}>Lost</button>
          {deal.status !== 'open' && <button onClick={() => onSetStatus(deal.id, 'open')} style={{ ...backBtn, background: 'transparent', color: '#fff', borderColor: '#444' }}>Reopen</button>}
          <CopyButton
            text={`[CRM-${deal.id}]`}
            title={`BCC crm@rockroofing.co.uk and put [CRM-${deal.id}] in the subject to file an email against this project. Click to copy.`}
            copiedLabel="Copied"
            style={{ background: 'transparent', border: '1px solid #444', color: '#aaa', fontSize: 11, fontFamily: 'ui-monospace, Menlo, monospace', padding: '4px 8px', borderRadius: 6, marginLeft: 4, display: 'flex', alignItems: 'center' }}>
            [CRM-{deal.id}]
          </CopyButton>
          <button onClick={() => onDeleteDeal(deal.id)} title="Delete this project permanently"
            style={{ background: 'none', border: 'none', color: '#ff6b6b', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', padding: '0 2px', marginLeft: 2 }}>
            Delete
          </button>
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
            {summaryFields.map((f) => <div key={f.key + f.label} style={sideRow}><span style={sideKey}>{f.label}</span><EditableField field={f} value={deal.fields[f.key]} onSave={(k, v) => onEditField(deal.id, k, v)} users={users} /></div>)}
          </SideBox>
          <SideBox title="Details" collapsed={collapsed.details} onToggle={() => toggle('details')}>
            {groupFields('details').map((f) => <div key={f.key + f.label} style={sideRow}><span style={sideKey}>{f.label}</span><EditableField field={f} value={deal.fields[f.key]} onSave={(k, v) => onEditField(deal.id, k, v)} users={users} /></div>)}
          </SideBox>
          <SideBox title="Customer Contact" collapsed={collapsed.person} onToggle={() => toggle('person')}>
            <div style={sideRow}><span style={sideKey}>Name</span><EditableField field={{ key: 'contact_person', type: 'text', search: 'contact' }} value={deal.fields.contact_person} onSave={(k, v) => onEditField(deal.id, k, v)} /></div>
            <div style={sideRow}><span style={sideKey}>First name</span><span style={sideVal}>{firstName(deal.fields.contact_person) || '-'}</span></div>
            <div style={sideRow}><span style={sideKey}>Last name</span><span style={sideVal}>{lastName(deal.fields.contact_person) || '-'}</span></div>
            {groupFields('person').filter((f) => f.key !== 'contact_person').map((f) => <div key={f.key + f.label} style={sideRow}><span style={sideKey}>{f.label}</span><EditableField field={f} value={deal.fields[f.key]} onSave={(k, v) => onEditField(deal.id, k, v)} users={users} /></div>)}
          </SideBox>
          <SideBox title="Organization" collapsed={collapsed.organization} onToggle={() => toggle('organization')}>
            <div style={sideRow}><span style={sideKey}>Company name</span><EditableField field={{ key: 'organization', type: 'text', search: 'org' }} value={deal.fields.organization} onSave={(k, v) => onEditField(deal.id, k, v)} /></div>
            {groupFields('organization').map((f) => <div key={f.key + f.label} style={sideRow}><span style={sideKey}>{f.label}</span><EditableField field={f} value={deal.fields[f.key]} onSave={(k, v) => onEditField(deal.id, k, v)} users={users} /></div>)}
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
                    {/* This used to read "(current user)" with an EMPTY value, so leaving
                        it alone saved the activity with nobody responsible. It now carries
                        the logged-in user's actual name. */}
                    {me?.name && <option value={me.name}>{me.name} (you)</option>}
                    <option value="">Nobody</option>
                    {(users || []).filter((u) => u.name !== me?.name).map((u) => <option key={u.username || u.name} value={u.name}>{u.name}</option>)}
                  </select>
                  <button disabled={!newDue} onClick={() => { onAddActivity(deal.id, newText.trim() || 'Call', newDue, newAssignee); setNewText(''); setNewDue(''); setNewAssignee(''); setAdding(false); }} style={{ ...primaryBtn, opacity: newDue ? 1 : 0.5 }}>Save</button>
                  {openActs.length > 0 && <button onClick={() => setAdding(false)} style={ghostBtn}>Cancel</button>}
                </div>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>Assigning someone else emails them (email would send in live version). Assigning yourself sends no email.</div>
              </div>
            )}
            {openActs.map((a) => <ActivityRow key={a.id} activity={a} overdue={a.due < today} me={me} users={users} onEdit={(id, t, d, who) => onEditActivity(deal.id, id, t, d, who)} onComplete={(id) => { onCompleteActivity(deal.id, id); setFlash(true); setAdding(true); }} onDelete={(id) => onDeleteActivity(deal.id, id)} />)}
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

          {lostFor != null && (
            <LostReasonModal
              schema={schema}
              onCancel={() => setLostFor(null)}
              onConfirm={(reason) => { onSetLostReason(deal.id, reason); onSetStatus(deal.id, 'lost'); setLostFor(null); }} />
          )}

          {/* Email - loads on its own, keyed to the deal */}
          <DealEmails dealId={deal.id} deals={allDeals} />

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
function EntityTable({ rows, fields, columns, sort, onSort, onDelete, noun }) {
  const { widths, startResize } = useColWidths(columns);
  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <table style={{ borderCollapse: 'collapse', background: '#fff', fontSize: 13, tableLayout: 'fixed' }}>
        <thead><tr>{columns.map((k) => { const lbl = (fields.find((f) => f[0] === k) || [k, k])[1]; const active = sort.key === k; return (
          <th key={k} onClick={() => onSort(k)} style={{ ...th, cursor: 'pointer', whiteSpace: 'nowrap', width: widths[k], position: 'relative', borderRight: `1px solid ${C.line}` }}>{lbl}{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}<ResizeHandle onMouseDown={(e) => startResize(k, e)} /></th>
        ); })}{onDelete && <th style={{ ...th, width: 70, whiteSpace: 'nowrap' }}>Delete</th>}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${C.line}` }}>
              {columns.map((k) => <td key={k} style={{ ...td, width: widths[k], borderRight: `1px solid ${C.faint}` }}>{k === 'open_value' ? money0(r[k]) : (r[k] ?? '-')}</td>)}
              {onDelete && (
                <td style={{ ...td, width: 70, textAlign: 'center' }}>
                  <button onClick={() => onDelete(r)} title={`Remove this ${noun || 'record'}`}
                    style={{ background: 'none', border: 'none', color: C.lost, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Delete</button>
                </td>
              )}
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
// Next.js replaces a crashed page with "Application error: a client-side exception has
// occurred", which tells you nothing and means the actual message is only in the console.
// This catches the error and shows it on screen instead, so it can be read or screenshotted
// without opening dev tools.
class CrmErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null, info: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { this.setState({ info }); console.error('CRM crashed:', err, info); }
  render() {
    if (!this.state.err) return this.props.children;
    const e = this.state.err;
    const stack = (this.state.info && this.state.info.componentStack) || e.stack || '';
    return (
      <div style={{ fontFamily: FONT, padding: 24, maxWidth: 900, margin: '0 auto', color: C.text }}>
        <h2 style={{ color: C.lost, margin: '0 0 6px' }}>Something in the CRM crashed</h2>
        <p style={{ fontSize: 13.5, color: C.dim, marginTop: 0 }}>
          Your data is safe - nothing has been saved or lost. Send this to Claude and it can be
          fixed from the detail below.
        </p>
        <div style={{ background: '#fff', border: '1px solid ' + C.line, borderRadius: 10, padding: 14, marginTop: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{String(e && e.message ? e.message : e)}</div>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11.5, color: '#666', marginTop: 10, maxHeight: 320, overflow: 'auto' }}>{stack}</pre>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button onClick={() => window.location.reload()} style={primaryBtn}>Reload</button>
          <button onClick={() => { try { window.localStorage.removeItem(PREFS_KEY); } catch {} window.location.href = '/crm'; }} style={ghostBtn}>
            Reload and clear saved view
          </button>
        </div>
      </div>
    );
  }
}

export default function CRMPage(props) {
  return <CrmErrorBoundary><CRMPageInner {...props} /></CrmErrorBoundary>;
}

function CRMPageInner() {
  // The REAL today, in UK local time, as YYYY-MM-DD so it compares directly with the
  // activity due dates. This was PREVIEW_TODAY - a date hard-coded into the preview seed
  // file when the demo data was generated. It never moved, so every activity due after
  // that date was treated as "in the future" no matter how overdue it actually was.
  const [today, setToday] = useState(todayISO());
  useEffect(() => {
    setToday(todayISO());
    // Roll over if the page is left open past midnight.
    const t = setInterval(() => setToday(todayISO()), 60 * 1000);
    return () => clearInterval(t);
  }, []);
  const router = useRouter();
  const [deals, setDeals] = useState([]);
  const [orgsData, setOrgsData] = useState([]);
  const [contactsData, setContactsData] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
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
  const [openActivities, setOpenActivities] = useState([]);
  const [activitySummary, setActivitySummary] = useState({});
  const [dealsAreSeed, setDealsAreSeed] = useState(false);
  const [me, setMe] = useState({ name: '', username: '' });
  const [users, setUsers] = useState([]);
  const resolveName = useMemo(() => buildNameResolver(users), [users]);
  const [deletedOrgs, setDeletedOrgs] = useState([]);
  const [deletedContacts, setDeletedContacts] = useState([]);
  const [actLoading, setActLoading] = useState(false);
  const [actSort, setActSort] = useState({ key: 'due', dir: 'asc' });
  const [actPerson, setActPerson] = useState('');
  const [actCustomer, setActCustomer] = useState('');
  const [actShowDone, setActShowDone] = useState(false);
  const [actSearch, setActSearch] = useState('');

  const [sort, setSort] = useState({ key: 'created', dir: 'desc' });
  const [entitySort, setEntitySort] = useState({ key: 'deals', dir: 'desc' });
  const [showAdd, setShowAdd] = useState(false);
  const [confetti, setConfetti] = useState(false);
  const [schema, setSchema] = useState(DEFAULT_FIELD_SCHEMA);
  const skipSave = useRef(true);
  const [saveError, setSaveError] = useState('');
  // id -> JSON of the deal as last successfully saved, so each save can send just the
  // deals that actually differ.
  const savedSnapshot = useRef(new Map());
  // id -> JSON of that deal's CRM-created activities as last written to the shared store.
  const prevActivities = useRef(new Map());
  const prevNotes = useRef(new Map());
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const importFileRef = useRef(null);
  const [showFieldMgr, setShowFieldMgr] = useState(false);

  // Restore remembered preferences once, on mount. Done in an effect rather than in the
  // useState initialisers so the server and the first client render agree - reading
  // localStorage during render would cause a hydration mismatch.
  // Escape hatch: if a remembered filter set leaves the CRM looking empty, this puts
  // everything back to how it opens out of the box.
  function resetView() {
    setView('pipeline'); setStatusFilter('open'); setMcsnEstimator('all');
    setCustomFilters([]); setStageMode('all'); setVisibleStages(new Set(STAGES.map((x) => x.id)));
    setColumns(DEFAULT_COLUMNS); setCompanyCols(DEFAULT_COMPANY_COLUMNS); setContactCols(DEFAULT_CONTACT_COLUMNS);
    setSort({ key: 'created', dir: 'desc' }); setEntitySort({ key: 'deals', dir: 'desc' });
    setActSort({ key: 'due', dir: 'asc' }); setActPerson(''); setActCustomer(''); setActShowDone(false);
    setQuery('');
    try { window.localStorage.removeItem(PREFS_KEY); } catch {}
  }

  const prefsReady = useRef(false);
  useEffect(() => {
    const p = loadPrefs();
    if (p) {
      if (p.view) setView(p.view);
      if (typeof p.statusFilter === 'string') setStatusFilter(p.statusFilter);
      if (typeof p.mcsnEstimator === 'string') setMcsnEstimator(p.mcsnEstimator);
      if (Array.isArray(p.customFilters)) setCustomFilters(p.customFilters);
      if (typeof p.stageMode === 'string') setStageMode(p.stageMode);
      if (Array.isArray(p.visibleStages)) setVisibleStages(new Set(p.visibleStages));
      if (Array.isArray(p.columns)) setColumns(p.columns);
      if (Array.isArray(p.companyCols)) setCompanyCols(p.companyCols);
      if (Array.isArray(p.contactCols)) setContactCols(p.contactCols);
      if (p.sort && p.sort.key) setSort(p.sort);
      if (p.entitySort && p.entitySort.key) setEntitySort(p.entitySort);
      if (p.actSort && p.actSort.key) setActSort(p.actSort);
      if (typeof p.actShowDone === 'boolean') setActShowDone(p.actShowDone);
      // Person / customer filters are deliberately NOT restored. Remembering them meant a
      // filter set weeks ago silently hid activities added today - which looked exactly
      // like the activity failing to save. Tab, columns and sort are still remembered;
      // these two reset each visit, and still hold while you are working.
      setActPerson(''); setActCustomer('');
    }
    prefsReady.current = true;
  }, []);

  // Save whenever any of them change. Guarded by prefsReady so the defaults do not
  // overwrite the saved set before it has been restored.
  useEffect(() => {
    if (!prefsReady.current) return;
    savePrefs({
      view, statusFilter, mcsnEstimator, customFilters, stageMode,
      visibleStages: Array.from(visibleStages),
      columns, companyCols, contactCols,
      sort, entitySort,
      actSort, actShowDone,
    });
  }, [view, statusFilter, mcsnEstimator, customFilters, stageMode, visibleStages,
      columns, companyCols, contactCols, sort, entitySort,
      actSort, actShowDone]);
  const dragId = useRef(null);
  const nextId = useRef(900000);

  useEffect(() => { if (!router.isReady) return; const q = router.query.deal; if (q) { setOpenId(Number(q)); loadDealSubs(Number(q)); } }, [router.isReady, router.query.deal]);

  // Load persisted CRM data (deals + schema) from the server on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/crm');
        const d = await r.json();
        if (cancelled) return;
        if (Array.isArray(d.deals)) {
          const actSum = d.activitySummary || {};
          const noteSum = d.noteSummary || {};
          setOpenActivities(Array.isArray(d.openActivities) ? d.openActivities : []);
          setActivitySummary(d.activitySummary || {});
          setDealsAreSeed(!!d.dealsAreSeed);
          if (d.me) setMe(d.me);
          if (Array.isArray(d.users)) setUsers(d.users);
          setDeletedOrgs(d.deletedOrgs || []);
          setDeletedContacts(d.deletedContacts || []);
          const seed = new Map();
          const actSeed = new Map();
          for (const x of d.deals) {
            seed.set(String(x.id), JSON.stringify({ ...leanDeal(x), __activities: crmActivities(x), __notes: crmNotes(x) }));
            // Deliberately NOT seeded with the deal's own activities. Anything still held
            // on a deal from before this change therefore looks new, and gets written
            // across to the shared store on the next save - a quiet one-off migration.
            actSeed.set(String(x.id), JSON.stringify(crmActivities(x)));
          }
          savedSnapshot.current = seed;
          prevActivities.current = actSeed;
          prevNotes.current = new Map(d.deals.map((x) => [String(x.id), JSON.stringify(crmNotes(x))]));
          setDeals(d.deals.map((x) => ({
            ...x, fields: { ...x.fields }, history: [...(x.history || [])],
            activities: [...(x.activities || [])], notes: [...(x.notes || [])],
            _actSummary: actSum[String(x.id)] || null,
            _noteSummary: noteSum[String(x.id)] || null,
          })));
        }
        if (Array.isArray(d.schema) && d.schema.length) setSchema(d.schema);
        if (Array.isArray(d.orgs)) setOrgsData(d.orgs);
        if (Array.isArray(d.contacts)) setContactsData(d.contacts);
      } catch (e) { /* ignore - stays empty */ }
      if (!cancelled) { setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist deals + schema whenever they change (debounced). Skips the initial load.
  useEffect(() => {
    if (!loaded) return;
    if (skipSave.current) { skipSave.current = false; return; }
    setSaving(true);
    const t = setTimeout(async () => {
      try {
        // Imported activities and notes are merged into a deal when you open it, so the
        // deal view can show them. They must not be written back - they already live in
        // their own per-deal stores.
        const lean = deals.map(leanDeal);

        // Attach each deal's own activities and notes so they are saved in the same
        // request as the deal itself.
        for (const d of lean) {
          const src = deals.find((x) => String(x.id) === String(d.id));
          if (!src) continue;
          d.__activities = crmActivities(src);
          d.__notes = crmNotes(src);
        }

        // Send ONLY what changed. The full list is ~6.4MB and Vercel refuses any request
        // body over 4.5MB, so a whole-list save can never succeed at this size.
        const prev = savedSnapshot.current;
        const changed = [];
        const nextSnap = new Map();
        // The comparison INCLUDES the attached activities and notes, so adding one marks
        // that deal as changed even if nothing else about it moved.
        for (const d of lean) {
          const json = JSON.stringify(d);
          nextSnap.set(String(d.id), json);
          if (prev.get(String(d.id)) !== json) changed.push(d);
        }
        const removedIds = [];
        for (const id of prev.keys()) if (!nextSnap.has(id)) removedIds.push(id);

        if (!changed.length && !removedIds.length) { setSaving(false); return; }

        // Batch by MEASURED SIZE. Normally one deal changes and this is a single small
        // request - but the first save after a cleanup can legitimately involve thousands,
        // and that must not hit the 4.5MB ceiling in one go.
        const MAX_BYTES = 3 * 1024 * 1024;
        const batches = [];
        let cur = [], curBytes = 0;
        for (const d of changed) {
          const b = JSON.stringify(d).length;
          if (cur.length && curBytes + b > MAX_BYTES) { batches.push(cur); cur = []; curBytes = 0; }
          cur.push(d); curBytes += b;
        }
        if (cur.length) batches.push(cur);
        if (!batches.length) batches.push([]);          // removals only

        // Activities go to the shared per-deal store, not into the deal record. Only for
        // deals that actually changed, so this is normally a single small request.
        // Activities and notes are written to their own stores BEFORE the deal is saved -
        // and the deal is saved with them stripped out. So if one of these writes fails,

        let ok = true;
        for (let bi = 0; bi < batches.length; bi++) {
          if (batches.length > 1) setSaveError(`Saving ${bi + 1} of ${batches.length}...`);
          const r = await fetch('/api/crm', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'save-deals-partial',
              deals: batches[bi],
              removedIds: bi === batches.length - 1 ? removedIds : [],
              schema: bi === 0 ? schema : undefined,
            }),
          });
          if (!r.ok) {
            setSaveError(`Save failed (server ${r.status}). Your last change is not stored.`);
            ok = false; break;
          }
        }
        if (ok) {
          savedSnapshot.current = nextSnap;   // only advance the baseline on success
          setSaveError('');
        }
      } catch (e) {
        setSaveError('Save failed - check your connection. Your last change is not stored.');
      }
      setSaving(false);
    }, 800);
    return () => clearTimeout(t);
  }, [deals, schema, loaded]);
  // Pull this deal's imported activities and notes on demand, once. Converts them to the
  // shape the deal view already uses (text/due) so nothing downstream needs to change.
  const loadedSubs = useRef({});
  async function loadDealSubs(id) {
    if (!id || loadedSubs.current[id]) return;
    loadedSubs.current[id] = true;
    try {
      const [a, n] = await Promise.all([
        fetch('/api/crm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get-sub', kind: 'activities', dealId: String(id) }) }).then((r) => r.json()),
        fetch('/api/crm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get-sub', kind: 'notes', dealId: String(id) }) }).then((r) => r.json()),
      ]);
      const acts = (a.items || []).map((x) => ({
        id: x.id, text: x.text || x.subject || 'Activity', due: x.dueDate || '',
        done: !!x.done, assignee: x.assignee || null, author: x.createdBy || null,
        type: x.type || '', imported: !x.crm,
      }));
      // Both imported and CRM-written notes come back from the same store. A CRM one keeps
      // its own id so its comments and edits still match up.
      const notes = (n.items || []).map((x) => x.crm
        ? { id: x.id, text: x.body || '', body: x.body || '', author: x.author || null, ts: x.ts || null, comments: x.comments || [], edited: !!x.edited, imported: false }
        : { id: x.id, text: stripHtml(x.html || ''), body: stripHtml(x.html || ''), author: x.author || null, ts: x.createdAt ? new Date(x.createdAt).toISOString() : null, comments: [], imported: true });
      if (!acts.length && !notes.length) return;
      // Deliberately NOT setting skipSave here.
      //
      // It used to, to avoid a pointless save when imported records were merged in. But
      // this runs asynchronously after you open a deal, so if you added an activity while
      // it was still loading, the sequence was:
      //   1. your activity  -> setDeals -> save scheduled (800ms debounce)
      //   2. this resolves  -> skipSave = true -> setDeals -> the effect's cleanup
      //      CANCELS your pending save, then skips this one too
      // Your activity was never written. Since imported records are now stripped before
      // saving anyway, letting this save is harmless - and it carries your change with it.
      setDeals((prev) => prev.map((d) => d.id !== id ? d : {
        ...d,
        activities: [...acts, ...(d.activities || [])],
        notes: [...notes, ...(d.notes || [])],
        history: [
          ...(d.history || []),
          ...acts.map((x) => ({ id: 'h_' + x.id, type: 'activity', ts: x.due ? new Date(x.due).toISOString() : null, text: `${x.done ? 'Activity completed' : 'Activity set'}: ${x.text}`, body: x.text })),
          ...notes.map((x) => x.imported
            ? { id: 'h_' + x.id, type: 'note', ts: x.ts, text: x.text, body: x.body, comments: [] }
            : { id: x.id, type: 'note', ts: x.ts, text: 'Note added', body: x.body, comments: x.comments, edited: x.edited, author: x.author }),
        ],
      }));
    } catch { /* leave the deal as-is if it fails */ }
  }

  const openDealById = (id) => { setOpenId(id); loadDealSubs(id); router.push({ pathname: '/crm', query: { deal: id } }, undefined, { shallow: true }); };
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
    // Live deal stats per organization (from the CRM's own deals).
    const stat = {};
    deals.forEach((d) => { const o = d.fields.organization; if (!o) return; if (!stat[o]) stat[o] = { deals: 0, open_value: 0, won: 0, lost: 0 }; stat[o].deals++; if (d.status === 'open') stat[o].open_value += Number(d.fields.value) || 0; if (d.status === 'won') stat[o].won++; if (d.status === 'lost') stat[o].lost++; });
    // Companies that exist only on a deal - added before this synced, or created while
    // offline - are appended so nothing is stranded. Marked so it is clear they came from
    // a project rather than the import.
    const extraOrgs = [];
    if (orgsData.length) {
      const known = new Set(orgsData.map((o) => String(o.name || '').trim().toLowerCase()));
      const seenX = new Set();
      deals.forEach((d) => {
        const o = d.fields.organization;
        if (!o) return;
        const k = String(o).trim().toLowerCase();
        if (!k || known.has(k) || seenX.has(k)) return;
        seenX.add(k);
        extraOrgs.push({
          name: o, org_address: d.fields.org_address || '-', org_phone: d.fields.org_phone || '-',
          org_website: d.fields.org_website || '-', org_email: d.fields.org_email || '-',
          org_reg_number: d.fields.org_reg_number || '-', supply_chain_approved: d.fields.supply_chain_approved || '-',
          deals: 0, open_value: 0, won: 0, lost: 0, addedInCrm: true,
        });
      });
      for (const e of extraOrgs) { const live = stat[e.name]; if (live) { e.deals = live.deals; e.open_value = live.open_value; e.won = live.won; e.lost = live.lost; } }
    }

    let rows;
    if (orgsData.length) {
      // Imported companies are the source of truth for company details.
      rows = orgsData.map((o) => { const live = stat[o.name]; return {
        name: o.name,
        org_address: o.org_address || '-', org_phone: o.org_phone || '-', org_website: o.org_website || '-', org_email: o.org_email || '-',
        org_reg_number: o.org_reg_number || '-',
        supply_chain_approved: o.supply_chain_approved || '-',
        deals: live ? live.deals : (o.pd_open_deals + o.pd_won_deals + o.pd_lost_deals),
        open_value: live ? live.open_value : 0,
        won: live ? live.won : o.pd_won_deals,
        lost: live ? live.lost : o.pd_lost_deals,
      }; });
    } else {
      // Fallback (pre-import): derive from deals as before.
      const m = {};
      deals.forEach((d) => { const o = d.fields.organization; if (!o) return; if (!m[o]) m[o] = { name: o, org_address: d.fields.org_address || '-', org_phone: d.fields.org_phone || '-', org_website: d.fields.org_website || '-', org_email: d.fields.org_email || '-', org_reg_number: d.fields.org_reg_number || '-', supply_chain_approved: '-', deals: 0, open_value: 0, won: 0, lost: 0 }; m[o].deals++; if (d.status === 'open') m[o].open_value += Number(d.fields.value) || 0; if (d.status === 'won') m[o].won++; if (d.status === 'lost') m[o].lost++; });
      rows = Object.values(m);
    }
    rows = [...rows, ...extraOrgs];
    // Anything deleted stays deleted, including if it still appears on a project.
    const goneO = new Set((deletedOrgs || []).map((n) => String(n).trim().toLowerCase()));
    if (goneO.size) rows = rows.filter((r) => !goneO.has(String(r.name || '').trim().toLowerCase()));
    const q = query.trim().toLowerCase(); if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q));
    const { key, dir } = entitySort; rows.sort((a, b) => { const av = a[key], bv = b[key]; if (av < bv) return dir === 'asc' ? -1 : 1; if (av > bv) return dir === 'asc' ? 1 : -1; return 0; });
    return rows;
  }, [deals, orgsData, query, entitySort, deletedOrgs]);

  const contactRows = useMemo(() => {
    // Live deal stats per contact name (from the CRM's own deals).
    const stat = {};
    deals.forEach((d) => { const c = d.fields.contact_person; if (!c) return; if (!stat[c]) stat[c] = { deals: 0, open_value: 0 }; stat[c].deals++; if (d.status === 'open') stat[c].open_value += Number(d.fields.value) || 0; });
    let rows;
    if (contactsData.length) {
      rows = contactsData.map((c) => { const live = stat[c.name]; return {
        name: c.name,
        first_name: c.first_name || firstName(c.name) || '-',
        last_name: c.last_name || lastName(c.name) || '-',
        organization: c.organization || '-',
        contact_phone: c.contact_phone || '-',
        contact_email: c.contact_email || '-',
        contact_job_role: c.contact_job_role || '-',
        deals: live ? live.deals : (c.pd_open_deals + c.pd_won_deals + c.pd_lost_deals),
        open_value: live ? live.open_value : 0,
      }; });
    } else {
      const m = {};
      deals.forEach((d) => { const c = d.fields.contact_person; if (!c) return; const key = c + '|' + (d.fields.organization || ''); if (!m[key]) m[key] = { name: c, first_name: firstName(c) || '-', last_name: lastName(c) || '-', organization: d.fields.organization || '-', contact_phone: d.fields.contact_phone || '-', contact_email: d.fields.contact_email || '-', contact_job_role: d.fields.contact_job_role || '-', deals: 0, open_value: 0 }; m[key].deals++; if (d.status === 'open') m[key].open_value += Number(d.fields.value) || 0; });
      rows = Object.values(m);
    }
    // Same safety net as Companies: list anyone who exists only on a deal.
    if (contactsData.length) {
      const known = new Set(contactsData.map((c) => String(c.name || '').trim().toLowerCase()));
      const seenX = new Set();
      const extra = [];
      deals.forEach((d) => {
        const c = d.fields.contact_person;
        if (!c) return;
        const k = String(c).trim().toLowerCase();
        if (!k || known.has(k) || seenX.has(k)) return;
        seenX.add(k);
        const live = stat[c];
        extra.push({
          name: c, first_name: firstName(c) || '-', last_name: lastName(c) || '-',
          organization: d.fields.organization || '-', contact_phone: d.fields.contact_phone || '-',
          contact_email: d.fields.contact_email || '-', contact_job_role: d.fields.contact_job_role || '-',
          deals: live ? live.deals : 0, open_value: live ? live.open_value : 0, addedInCrm: true,
        });
      });
      rows = [...rows, ...extra];
    }
    const goneC = new Set((deletedContacts || []).map((n) => String(n).trim().toLowerCase()));
    if (goneC.size) rows = rows.filter((r) => !goneC.has(String(r.name || '').trim().toLowerCase()));
    const q = query.trim().toLowerCase(); if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || (r.organization || '').toLowerCase().includes(q));
    const { key, dir } = entitySort; rows.sort((a, b) => { const av = a[key], bv = b[key]; if (av < bv) return dir === 'asc' ? -1 : 1; if (av > bv) return dir === 'asc' ? 1 : -1; return 0; });
    return rows;
  }, [deals, contactsData, query, entitySort, deletedContacts]);

  const totalValue = finalList.filter((d) => d.status === 'open').reduce((s, d) => s + (Number(d.fields.value) || 0), 0);

  // mutations
  async function handleImportFile(file) {
    if (!file) return;
    setImporting(true); setImportMsg('Reading file...');

    // --- Step 1: read + parse the file (own error boundary) ---
    let rows, kind;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { defval: null });
    } catch (e) {
      setImportMsg('Could not read that file. Make sure it is the Pipedrive export (.xlsx or .csv), not opened/locked in Excel.');
      setImporting(false); return;
    }
    if (!rows || !rows.length) { setImportMsg('That file has no rows.'); setImporting(false); return; }
    const headers = Object.keys(rows[0]);
    kind = detectExportType(headers);
    if (!kind) { setImportMsg('Unrecognised file. Upload a Pipedrive Deals, Organizations, People, Activities or Notes export.'); setImporting(false); return; }

    // --- Activities / Notes take their own path: grouped per deal, not one flat list ---
    if (kind === 'activities' || kind === 'notes') {
      let items, skipped;
      try {
        if (kind === 'activities') { const r = mapActivityRows(rows); items = r.activities; skipped = r.skipped; }
        else { const r = mapNoteRows(rows); items = r.notes; skipped = r.skipped; }
      } catch (e) {
        setImportMsg('Could not map that file (' + (e && e.message ? e.message : 'unexpected format') + ').');
        setImporting(false); return;
      }
      if (!items.length) { setImportMsg('No rows in that file are linked to a deal, so there is nothing to import.'); setImporting(false); return; }

      // Only keep records whose deal is actually IN the CRM. Without this, anything
      // belonging to a deal you did not import (another pipeline, or one deleted in
      // Pipedrive) is written to a key nothing will ever read - invisible clutter that
      // grows with every import.
      const dealIds = new Set((deals || []).map((d) => String(d.id)));
      if (!dealIds.size) {
        setImportMsg('Import your Deals export first - activities and notes attach to deals, so there is nothing to attach these to yet.');
        setImporting(false); return;
      }
      const before = items.length;
      items = items.filter((x) => dealIds.has(String(x.dealId)));
      const orphaned = before - items.length;
      if (!items.length) {
        setImportMsg(`None of the ${before} records in that file belong to a deal in the CRM. Check you have imported the matching Deals export.`);
        setImporting(false); return;
      }

      const groups = groupByDeal(items);

      // The index and the board summary are computed here, once, and sent with the final
      // chunk - rather than the server rebuilding them on every chunk.
      const allDealIds = groups.map((g) => String(g.dealId));
      // Flat list of everything still OUTSTANDING, for the Activities tab. Only open ones,
      // so it stays around a thousand rows rather than the full 32k of history.
      const openList = kind !== 'activities' ? [] : items
        .filter((a) => !a.done)
        .map((a) => ({ id: a.id, dealId: a.dealId, text: a.subject || a.text || 'Activity', due: a.dueDate || '', assignee: a.assignee || '' }));
      const summary = {};
      for (const g of groups) {
        if (kind === 'notes') { summary[String(g.dealId)] = { total: g.items.length }; continue; }
        const open = g.items.filter((a) => !a.done);
        const dues = open.map((a) => a.dueDate).filter(Boolean).sort();
        summary[String(g.dealId)] = { total: g.items.length, open: open.length, next: dues[0] || '' };
      }

      // Chunk by MEASURED SIZE, not by a fixed number of projects. A fixed count is a
      // guess: one project with 96 activities is worth a hundred with one each, so a
      // busy run of projects can blow the request-body limit even when the average is
      // fine. That is what returned 413. Build each chunk up to a byte budget instead,
      // with a project cap as a second guard.
      const MAX_BYTES = 3 * 1024 * 1024;   // 3MB against an 8MB server limit
      const MAX_GROUPS = 400;
      const chunks = [];
      {
        let cur = [], curBytes = 0;
        for (const g of groups) {
          const gBytes = JSON.stringify(g).length;
          if (cur.length && (curBytes + gBytes > MAX_BYTES || cur.length >= MAX_GROUPS)) {
            chunks.push(cur); cur = []; curBytes = 0;
          }
          cur.push(g); curBytes += gBytes;
        }
        if (cur.length) chunks.push(cur);
      }

      try {
        let written = 0;
        const started = Date.now();
        let sentGroups = 0;
        for (let ci = 0; ci < chunks.length; ci++) {
          const slice = chunks[ci];
          const i = sentGroups;
          const first = ci === 0;
          const last = ci === chunks.length - 1;
          sentGroups += slice.length;
          const doneSoFar = sentGroups;
          const pct = Math.round((doneSoFar / groups.length) * 100);
          let eta = '';
          if (i > 0) {
            const perProject = (Date.now() - started) / i;
            const secs = Math.round((perProject * (groups.length - i)) / 1000);
            if (secs > 5) eta = ` - about ${secs > 90 ? Math.round(secs / 60) + ' min' : secs + 's'} left`;
          }
          setImportMsg(`Saving ${doneSoFar} of ${groups.length} projects (${pct}%)${eta}`);
          const r = await fetch('/api/crm', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'import-sub', kind, groups: slice, first, last,
              ...(first ? { allDealIds } : {}),
              ...(last ? { index: allDealIds, summary, openList } : {}),
            }),
          });
          if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || ('server ' + r.status)); }
          const d = await r.json();
          written += d.written || 0;
        }
        const noun = kind === 'activities' ? 'activities' : 'notes';
        const extra = [];
        if (skipped) extra.push(`${skipped} not linked to a deal`);
        if (orphaned) extra.push(`${orphaned} for deals not in the CRM`);
        setImportMsg(`Imported ${written} ${noun} across ${groups.length} projects`
          + (extra.length ? ` (skipped: ${extra.join('; ')}).` : '.'));
        if (importFileRef.current) importFileRef.current.value = '';
      } catch (e) {
        setImportMsg('Saving failed (' + (e && e.message ? e.message : 'unknown') + '). Re-run the import to retry.');
      }
      setImporting(false); return;
    }

    // --- Step 2: map to CRM shape ---
    let mapped, skipped, chunkKind;
    try {
      if (kind === 'deals') { const r = mapPipedriveRows(rows); mapped = r.deals; skipped = r.skipped; chunkKind = 'deals'; }
      else if (kind === 'orgs') { const r = mapOrganizationRows(rows); mapped = r.orgs; skipped = r.skipped; chunkKind = 'orgs'; }
      else { const r = mapPeopleRows(rows); mapped = r.contacts; skipped = r.skipped; chunkKind = 'contacts'; }
    } catch (e) {
      setImportMsg('Could not map that file (' + (e && e.message ? e.message : 'unexpected format') + ').');
      setImporting(false); return;
    }
    if (!mapped.length) { setImportMsg('No records found in that file.'); setImporting(false); return; }

    // --- Step 3: save in chunks (avoids the ~4.5MB serverless body limit) ---
    const CHUNK = 500;
    try {
      let saved = 0;
      for (let i = 0; i < mapped.length; i += CHUNK) {
        const slice = mapped.slice(i, i + CHUNK);
        const first = i === 0;
        const last = i + CHUNK >= mapped.length;
        setImportMsg(`Saving ${Math.min(i + CHUNK, mapped.length)} of ${mapped.length}...`);
        const r = await fetch('/api/crm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'import-chunk', kind: chunkKind, rows: slice, first, last }) });
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || ('server ' + r.status)); }
        const d = await r.json();
        saved = d.count;
      }
      // Reflect in memory.
      if (chunkKind === 'deals') { skipSave.current = true; setDeals(mapped); }
      else if (chunkKind === 'orgs') setOrgsData(mapped);
      else setContactsData(mapped);
      const noun = chunkKind === 'deals' ? 'deals' : chunkKind === 'orgs' ? 'companies' : 'contacts';
      setImportMsg(`Imported ${saved} ${noun}${skipped ? ` (${skipped} skipped)` : ''}.`);
      if (importFileRef.current) importFileRef.current.value = '';
    } catch (e) {
      setImportMsg('Saving failed (' + (e && e.message ? e.message : 'unknown') + '). Some rows may have saved; re-run the import to retry.');
    }
    setImporting(false);
  }

  const patch = (id, fn) => setDeals((prev) => prev.map((d) => d.id === id ? fn(d) : d));
  // Moving a project into Negotiating always needs the same four things doing, so they are
  // created as activities rather than relying on anyone remembering. Assigned to the Sales
  // Person on the deal; if there is not one, they are created unassigned and the card's
  // warning picks that up.
  const NEGOTIATING_TASKS = [
    'Update Details information for Post Contract: Location, m2, Value, Credit Score, Credit Limit, Credit Insurance, Roofing Works on Site, Description of Project Scope of Works (Comprehensive list of all systems and types)',
    'Have we added the company to Top Service monitoring?',
    'Confirm provisional start on site date internally or with the Customer',
    'Have we confirmed a fully insured limit? Notify Director if full limit not obtained.',
  ];

  const moveDeal = (id, stageId) => {
    const before = deals.find((x) => x.id === id);
    const entering = stageId === 'stage_negotiating' && before && before.stageId !== 'stage_negotiating';
    moveDealStage(id, stageId);
    if (!entering) return;

    // ONCE ONLY, for the life of the project. Recorded on the deal itself rather than
    // worked out from the activities that happen to be there - otherwise completing them
    // and moving out and back in would create a fresh set.
    if (before.negotiatingTasksAdded) return;

    const owner = before.fields?.sales_person || null;
    const due = todayISO();
    for (const t of NEGOTIATING_TASKS) addActivity(id, t, due, owner);
    patch(id, (d) => ({ ...d, negotiatingTasksAdded: nowIso() }));
  };

  const moveDealStage = (id, stageId) => patch(id, (d) => d.stageId === stageId ? d : { ...d, stageId, history: [...d.history, { id: uid(), type: 'stage', ts: nowIso(), text: `Stage: ${stageLabel(d.stageId)} → ${stageLabel(stageId)}`, stageFrom: stageLabel(d.stageId), stageTo: stageLabel(stageId), value: Number(d.fields?.value) || 0 }] });
  // Marking a deal won or lost must ALSO stamp the date it happened.
  //
  // It did not, and the consequence was invisible: the dashboard and scorecards build
  // closeTime from won_time / lost_time, so a deal decided in the CRM had no close date
  // and dropped out of every date-filtered view. Imported deals were fine - they carried
  // the date from Pipedrive - so only deals decided HERE went missing, which is the
  // hardest kind of gap to notice.
  //
  // Reopening clears both, so a deal that goes won -> open -> lost does not keep a stale
  // won date hanging off it.
  const setStatus = (id, status) => {
    patch(id, (d) => {
      const text = status === 'won' ? 'Deal marked Won' : status === 'lost' ? 'Deal marked Lost' : 'Deal reopened';
      const ts = nowIso();
      const fields = { ...d.fields };
      if (status === 'won') { fields.won_time = ts; fields.lost_time = null; }
      else if (status === 'lost') { fields.lost_time = ts; fields.won_time = null; }
      else { fields.won_time = null; fields.lost_time = null; }
      return { ...d, status, fields, history: [...d.history, { id: uid(), type: status === 'open' ? 'note' : status, ts, text }] };
    });
    if (status === 'won') setConfetti(true);
  };
  const addNote = (id, body) => { const m = extractMentions(body); patch(id, (d) => { const ev = [{ id: uid(), type: 'note', ts: nowIso(), text: 'Note added', body, comments: [] }]; if (m.length) ev.push({ id: uid(), type: 'mention', ts: nowIso(), text: `Notified: ${m.join(', ')} (email would send in live version)` }); return { ...d, history: [...d.history, ...ev] }; }); };
  const commentNote = (id, hid, body) => { const m = extractMentions(body); patch(id, (d) => { const withComment = d.history.map((h) => h.id === hid ? { ...h, comments: [...(h.comments || []), { id: uid(), body, ts: nowIso() }] } : h); const extra = m.length ? [{ id: uid(), type: 'mention', ts: nowIso(), text: `Notified: ${m.join(', ')} (email would send in live version)` }] : []; return { ...d, history: [...withComment, ...extra] }; }); };
  const editHistory = (id, hid, body) => patch(id, (d) => ({ ...d, history: d.history.map((h) => h.id === hid ? { ...h, body, edited: true } : h) }));
  const editHistoryActivity = (id, hid, body, ts) => patch(id, (d) => ({ ...d, history: d.history.map((h) => h.id === hid ? { ...h, body, ts, edited: true } : h) }));
  const deleteHistory = (id, hid) => patch(id, (d) => ({ ...d, history: d.history.filter((h) => h.id !== hid) }));
  const reopenActivity = (id, hid) => patch(id, (d) => { const h = d.history.find((x) => x.id === hid); const text = h ? (h.body || h.text) : 'Activity'; return { ...d, activities: [...d.activities, { id: uid(), text, due: today, done: false }], history: [...d.history, { id: uid(), type: 'activity', ts: nowIso(), text: `Activity reopened: ${text}`, body: text }] }; });
  const addActivity = (id, text, due, assignee) => { const m = extractMentions(text); patch(id, (d) => { const a = { id: uid(), text, due, done: false, assignee: assignee || null, author: null }; const ev = [{ id: uid(), type: 'activity', ts: nowIso(), text: `Activity set: ${text} (due ${shortDate(due)})${assignee ? `, assigned to ${assignee}` : ''}`, body: text }]; if (assignee) ev.push({ id: uid(), type: 'mention', ts: nowIso(), text: `${assignee} assigned an activity — email would send in live version` }); if (m.length) ev.push({ id: uid(), type: 'mention', ts: nowIso(), text: `Notified: ${m.join(', ')} (email would send in live version)` }); return { ...d, activities: [...d.activities, a], history: [...d.history, ...ev] }; }); };
  // Keeps the assignee. It used to drop it, so editing an activity from the deal quietly
  // cleared whoever was responsible for it.
  const editActivity = (id, aid, text, due, assignee) => patch(id, (d) => ({
    ...d,
    activities: d.activities.map((a) => a.id === aid
      ? { ...a, text, due, assignee: assignee === undefined ? (a.assignee || null) : (assignee || null) }
      : a),
  }));
  const completeActivity = (id, aid) => { patch(id, (d) => { const act = d.activities.find((a) => a.id === aid); return { ...d, activities: d.activities.map((a) => a.id === aid ? { ...a, done: true } : a), history: [...d.history, { id: uid(), type: 'activity', ts: nowIso(), text: `Activity completed: ${act ? act.text : ''}`, body: act ? act.text : '' }] }; }); };
  const deleteActivity = (id, aid) => patch(id, (d) => ({ ...d, activities: d.activities.filter((a) => a.id !== aid) }));
  // Company / contact detail fields that should flow back to the master lists when they
  // are edited on a deal.
  const ORG_KEYS = ['organization', 'org_address', 'org_phone', 'org_website', 'org_email', 'org_reg_number', 'supply_chain_approved'];
  const CONTACT_KEYS = ['contact_person', 'contact_phone', 'contact_email', 'contact_job_role'];

  const editField = (id, key, val) => {
    // The Tender return activity follows the Estimator Responsible. Set or change the
    // estimator and the activity is reassigned to them, so the two cannot disagree.
    // Setting the Sales Person picks up the Negotiating handover tasks that were created
    // without an owner, so they do not sit unassigned once someone is named.
    if (key === 'sales_person' && val) {
      const d0 = deals.find((x) => x.id === id);
      if (d0) {
        const names = new Set(NEGOTIATING_TASKS.map((t) => t.trim().toLowerCase()));
        if ((d0.activities || []).some((a) => !a.done && !a.assignee && names.has((a.text || '').trim().toLowerCase()))) {
          patch(id, (d) => ({
            ...d,
            activities: d.activities.map((a) => (!a.done && !a.assignee && names.has((a.text || '').trim().toLowerCase()))
              ? { ...a, assignee: val } : a),
          }));
        }
      }
    }

    if (key === 'estimator_responsible') {
      const d0 = deals.find((x) => x.id === id);
      if (d0 && (d0.activities || []).some((a) => a.text === 'Tender return' && !a.done)) {
        patch(id, (d) => ({
          ...d,
          activities: d.activities.map((a) => (a.text === 'Tender return' && !a.done) ? { ...a, assignee: val || null } : a),
        }));
      }
    }

    // Editing any of these on the project keeps the Companies / Contacts pages in step,
    // so a detail added here is not stranded on the deal.
    if (ORG_KEYS.includes(key) || CONTACT_KEYS.includes(key)) {
      try {
      const d0 = deals.find((x) => x.id === id);
      if (d0) {
        const f = { ...d0.fields, [key]: val };
        if (f.organization) {
          upsertOrg({ name: f.organization, org_address: f.org_address, org_phone: f.org_phone, org_website: f.org_website, org_email: f.org_email, org_reg_number: f.org_reg_number, supply_chain_approved: f.supply_chain_approved });
        }
        if (f.contact_person) {
          upsertContact({ name: f.contact_person, organization: f.organization, contact_phone: f.contact_phone, contact_email: f.contact_email, contact_job_role: f.contact_job_role });
        }
      }
      } catch (e) { console.error('Could not file the company/contact record:', e); }
    }
    return patch(id, (d) => {
    const old = d.fields[key];
    const hist = (key === 'value') ? [{ id: uid(), type: 'value', ts: nowIso(), text: `Value: ${money(old)} → ${money(val)}`, oldValue: Number(old) || 0, newValue: Number(val) || 0 }]
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
  };

  // Push a company / contact into the master lists so it appears on the Companies and
  // Contacts pages. Called when a project is created with a new one, and when the
  // organisation or contact details are edited on the deal itself.
  // Deleting only removes the record from these pages. The projects that reference the
  // name are untouched - nothing is orphaned and no history is lost.
  async function deleteCompany(row) {
    const name = String(row?.name || '').trim();
    if (!name) return;
    if (!window.confirm(`Remove "${name}" from Companies?\n\nProjects that reference this company are not affected.`)) return;
    setDeletedOrgs((p) => [...p, name]);
    setOrgsData((p) => p.filter((o) => String(o.name || '').trim().toLowerCase() !== name.toLowerCase()));
    try {
      await fetch('/api/crm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete-org', name }) });
    } catch (e) { console.error('Could not delete the company:', e); }
  }

  async function deleteContact(row) {
    const name = String(row?.name || '').trim();
    if (!name) return;
    if (!window.confirm(`Remove "${name}" from Contacts?\n\nProjects that reference this person are not affected.`)) return;
    setDeletedContacts((p) => [...p, name]);
    setContactsData((p) => p.filter((c) => String(c.name || '').trim().toLowerCase() !== name.toLowerCase()));
    try {
      await fetch('/api/crm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete-contact', name }) });
    } catch (e) { console.error('Could not delete the contact:', e); }
  }

  async function upsertOrg(rec) {
    const name = String(rec?.name || '').trim();
    if (!name) return;
    setOrgsData((prev) => {
      const i = prev.findIndex((o) => String(o.name || '').trim().toLowerCase() === name.toLowerCase());
      if (i < 0) return [...prev, { ...rec, name, addedInCrm: true }];
      const merged = { ...prev[i] };
      for (const [k, v] of Object.entries(rec)) if (v !== null && v !== undefined && String(v).trim() !== '') merged[k] = v;
      return prev.map((o, j) => j === i ? merged : o);
    });
    try {
      await fetch('/api/crm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upsert-org', record: { ...rec, name } }) });
    } catch { /* the on-screen list still updates; it will re-sync on the next save */ }
  }

  async function upsertContact(rec) {
    const name = String(rec?.name || '').trim();
    if (!name) return;
    setContactsData((prev) => {
      const i = prev.findIndex((c) => String(c.name || '').trim().toLowerCase() === name.toLowerCase());
      if (i < 0) return [...prev, { ...rec, name, first_name: firstName(name), last_name: lastName(name), addedInCrm: true }];
      const merged = { ...prev[i] };
      for (const [k, v] of Object.entries(rec)) if (v !== null && v !== undefined && String(v).trim() !== '') merged[k] = v;
      return prev.map((c, j) => j === i ? merged : c);
    });
    try {
      await fetch('/api/crm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upsert-contact', record: { ...rec, name, first_name: firstName(name), last_name: lastName(name) } }) });
    } catch { /* as above */ }
  }

  // Delete a project outright. Removes the deal AND its activities and notes, which live in
  // their own per-deal stores - otherwise those would be left behind as orphans that
  // nothing can ever read or clear.
  async function deleteDeal(id) {
    const d = deals.find((x) => x.id === id);
    const name = d ? d.title : 'this project';
    if (!window.confirm(`Delete "${name}"?\n\nThis removes the project and all of its activities, notes and history. It cannot be undone.`)) return;
    if (!window.confirm(`Last check - permanently delete "${name}"?`)) return;

    closeDeal();
    setDeals((prev) => prev.filter((x) => x.id !== id));
    setOpenActivities((prev) => prev.filter((a) => String(a.dealId) !== String(id)));
    try {
      await fetch('/api/crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-deal', dealId: String(id) }),
      });
      savedSnapshot.current.delete(String(id));
      prevActivities.current.delete(String(id));
      prevNotes.current.delete(String(id));
    } catch (e) {
      setSaveError('The project could not be deleted on the server - reload before carrying on.');
    }
  }

  // Written before the status change, so the deal is saved once with both.
  const setLostReason = (id, reason) => patch(id, (d) => ({ ...d, fields: { ...d.fields, lost_reason: reason || null } }));

  const createProject = (data) => {
    const id = nextId.current++;
    const fields = { value: Number(data.value) || 0, organization: data.organization || null, contact_person: data.contact_person || null, owner: null, created: nowIso().slice(0, 10), expected_close_date: data.expected_close_date || null, project_score: data.project_score || null };
    ['site_location','site_postcode','region','size_m2','credit_score','credit_limit','insured_credit_limit','glenigan_id','estimator_responsible','project_stage','roofing_works_onsite','sales_person','project_start_date','project_type','systems_priced','lead_source','scope_of_works','general_info','contact_phone','contact_email','contact_job_role','org_address','org_phone','org_website','org_email','org_reg_number','supply_chain_approved'].forEach((k) => { fields[k] = data[k] || null; });
    const link = (fields.contact_person && fields.organization) ? { person: fields.contact_person, org: fields.organization, ts: nowIso() } : null;
    const d = { id, title: data.title, stageId: data.stageId || 'stage_project_in', status: 'open', fields, link, activities: [], notes: [], history: [{ id: uid(), type: 'note', ts: nowIso(), text: 'Project created' }] };
    setDeals((prev) => [d, ...prev]); setShowAdd(false); openDealById(id);

    // A tender return date becomes an ACTIVITY rather than a field sitting in the summary,
    // so it turns up on the Activities tab and drives the kanban dot like any other date
    // that has to be worked to.
    if (fields.expected_close_date) {
      addActivity(id, 'Tender return', fields.expected_close_date, fields.estimator_responsible || null);
    }

    // Anything typed into the new-company / new-contact panels becomes a real record.
    // Wrapped: creating the project is the important part, and must not fail because
    // filing the company or contact did.
    try {
    if (fields.organization) {
      upsertOrg({
        name: fields.organization, org_address: fields.org_address, org_phone: fields.org_phone,
        org_website: fields.org_website, org_email: fields.org_email,
        org_reg_number: fields.org_reg_number, supply_chain_approved: fields.supply_chain_approved,
      });
    }
    if (fields.contact_person) {
      upsertContact({
        name: fields.contact_person, organization: fields.organization,
        contact_phone: fields.contact_phone, contact_email: fields.contact_email,
        contact_job_role: fields.contact_job_role,
      });
    }
    } catch (e) { console.error('Could not file the company/contact record:', e); }
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

  // NOTE: these hooks MUST stay above the `if (live) return` below. React requires the
  // same hooks in the same order on every render; when they sat after the early return,
  // opening a deal rendered fewer hooks and threw React error #300.
  // Re-fetch just the activity state, so an estimator's progress reaches the salesperson
  // without either of them reloading. Deliberately does NOT re-fetch the deals - that is
  // 6.4MB and would make this too expensive to do often.
  const [actRefreshedAt, setActRefreshedAt] = useState(null);
  const refreshingRef = useRef(false);
  // Writes still in flight. The background refresh must not overwrite the screen with
  // server data that does not yet include a change being saved - that would make a row
  // you just completed flicker back.
  const pendingWrites = useRef(0);

  async function refreshActivityState() {
    if (refreshingRef.current || pendingWrites.current > 0) return;
    refreshingRef.current = true;
    try {
      const d = await fetch('/api/crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activity-state' }),
      }).then((r) => r.json());
      if (d && d.ok) {
        setOpenActivities(d.openActivities || []);
        setActivitySummary(d.activitySummary || {});
        setActRefreshedAt(Date.now());
      }
    } catch { /* leave what we have */ }
    refreshingRef.current = false;
  }

  // Refresh when you come back to the tab, and every 60s while the Activities tab is open.
  // Nothing polls while you are elsewhere in the app or in another window.
  useEffect(() => {
    if (!loaded) return;
    const onFocus = () => { if (!document.hidden) refreshActivityState(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    let t = null;
    if (view === 'activities') {
      refreshActivityState();
      t = setInterval(() => { if (!document.hidden) refreshActivityState(); }, 60 * 1000);
    }
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      if (t) clearInterval(t);
    };
  }, [view, loaded]);

  // Activities imported BEFORE the flat open-list existed have no aggregate to read, so
  // the tab would sit empty until the next import. The per-deal summary still knows which
  // deals have outstanding activities, so fetch just those - usually a few hundred at
  // most, not the 5,000+ that have only completed history.
  const healedRef = useRef(false);
  useEffect(() => {
    if (view !== 'activities' || healedRef.current) return;

    // Do NOT give up just because the summary has not arrived yet. Since the CRM now
    // remembers your last tab, landing straight on Activities means this effect runs
    // BEFORE the data loads - and the old guard marked itself finished at that point and
    // never ran again. Wait for the summary instead; the effect re-runs when it lands.
    if (!Object.keys(activitySummary || {}).length) return;

    if (openActivities.length) { healedRef.current = true; return; }
    const needed = Object.entries(activitySummary).filter(([, v]) => (v?.open || 0) > 0).map(([id]) => id);
    if (!needed.length) { healedRef.current = true; return; }
    healedRef.current = true;
    (async () => {
      setActLoading(true);
      try {
        const found = [];
        for (let i = 0; i < needed.length; i += 150) {
          const d = await fetch('/api/crm', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'get-sub-many', kind: 'activities', dealIds: needed.slice(i, i + 150) }),
          }).then((r) => r.json());
          for (const [dealId, list] of Object.entries(d.items || {})) {
            for (const a of (list || [])) {
              if (a.done) continue;
              found.push({ id: a.id, dealId, text: a.subject || a.text || 'Activity', due: a.dueDate || '', assignee: a.assignee || '' });
            }
          }
        }
        if (found.length) {
          setOpenActivities(found);
          // Cache it, so this rebuild happens once rather than on every page load. That
          // rebuild is why the tab was slow to open.
          try {
            await fetch('/api/crm', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'save-open-activities', openList: found }),
            });
          } catch { /* not fatal - it just rebuilds again next time */ }
        }
      } catch { /* leave the tab empty rather than erroring */ }
      setActLoading(false);
    })();
  }, [view, activitySummary, openActivities.length]);

  const activityRowsAll = useMemo(() => {
    const dealById = new Map(deals.map((d) => [String(d.id), d]));
    const contactByName = new Map();
    for (const c of (contactsData || [])) {
      const n = String(c.name || '').trim().toLowerCase();
      if (n && !contactByName.has(n)) contactByName.set(n, c);
    }

    const seen = new Set();
    const rows = [];
    const push = (a, dealId, done, source) => {
      const key = `${dealId}|${a.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      const deal = dealById.get(String(dealId));
      if (!deal) return;                                  // deal not in the CRM
      // Open projects only - chasing work on a job won or lost months ago is noise. But the
      // row is still built and tagged, so the table can SAY how many it is holding back
      // rather than leaving you wondering where an activity went.
      const dealOpen = deal.status === 'open';
      const custName = deal.fields?.contact_person || '';
      const contact = contactByName.get(String(custName).trim().toLowerCase());
      rows.push({
        id: key,
        rawId: a.id,
        dealId,
        project: deal.title || '',
        stage: (STAGES.find((x) => x.id === deal.stageId) || {}).label || '',
        text: a.text || 'Activity',
        due: a.due || '',
        assignee: resolveName(a.assignee || ''),
        company: deal.fields?.organization || '',
        customer: custName,
        email: contact?.contact_email || '',
        phone: contact?.contact_phone || '',
        done: !!done,
        dealOpen,
        dealStatus: deal.status,
        source,
      });
    };

    for (const a of (openActivities || [])) push(a, a.dealId, false, 'imported');
    for (const d of deals) {
      for (const a of (d.activities || [])) {
        if (!actShowDone && a.done) continue;
        push(a, d.id, a.done, a.imported ? 'imported' : 'crm');
      }
    }
    return rows;
  }, [deals, contactsData, openActivities, actShowDone, resolveName]);

  // Open projects only. Activities on won or lost jobs are counted but not listed - the
  // count line below still reports them, so they are never hidden silently.
  const activityRows = useMemo(() => activityRowsAll.filter((r) => r.dealStatus === 'open'), [activityRowsAll]);
  const activityClosedCount = useMemo(() => activityRowsAll.filter((r) => r.dealStatus !== 'open').length, [activityRowsAll]);



  // True when a saved filter matches nothing at all, so it can be ignored rather than
  // silently emptying the table. Removed by accident when the diagnostics came out in
  // pkg349 - it was still being used, which is what crashed the tab.
  const activityStaleFilter = useMemo(() => (
    (!!actPerson && !activityRows.some((r) => r.assignee === actPerson)) ||
    (!!actCustomer && !activityRows.some((r) => r.company === actCustomer))
  ), [actPerson, actCustomer, activityRows]);

  const actPeople = useMemo(() => [...new Set(activityRows.map((r) => r.assignee).filter(Boolean))].sort(), [activityRows]);
  const actCustomers = useMemo(() => [...new Set(activityRows.map((r) => r.company).filter(Boolean))].sort(), [activityRows]);

  const activitiesShown = useMemo(() => {
    let rows = activityRows;
    const q = actSearch.trim().toLowerCase();
    if (q) rows = rows.filter((r) => `${r.project} ${r.text} ${r.assignee} ${r.company} ${r.customer}`.toLowerCase().includes(q));
    // A remembered filter that no longer matches ANYTHING is ignored rather than obeyed.
    // Saved filters persist between visits, so a person who is no longer on any activity -
    // or who never was, if you assigned nobody - would otherwise silently empty the table
    // with no clue as to why.
    const personLive = actPerson && activityRows.some((r) => r.assignee === actPerson);
    const customerLive = actCustomer && activityRows.some((r) => r.company === actCustomer);
    if (personLive) rows = rows.filter((r) => r.assignee === actPerson);
    if (customerLive) rows = rows.filter((r) => r.company === actCustomer);
    const { key, dir } = actSort;
    const mul = dir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      const av = String(a[key] ?? '').trim();
      const bv = String(b[key] ?? '').trim();
      // Blanks last whichever way it is sorted - a missing due date should not head the list.
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return mul * av.localeCompare(bv, 'en-GB', { sensitivity: 'base', numeric: true });
    });
  }, [activityRows, actPerson, actCustomer, actSort, actSearch]);

  const live = deals.find((d) => d.id === openId) || null;
  if (live) {
    return (
      <div style={{ fontFamily: FONT, color: C.text }}>
        <FontLoader />
        {confetti && <Confetti onDone={() => setConfetti(false)} />}
        {showFieldMgr && <FieldManager schema={schema} onClose={() => setShowFieldMgr(false)} onAdd={addField} onRemove={removeField} />}
        <DealView deal={live} allDeals={deals} onSetLostReason={setLostReason} today={today} schema={schema} me={me} users={users} onBack={closeDeal} onMove={moveDeal} onSetStatus={setStatus} onAddNote={addNote} onCommentNote={commentNote} onEditHistory={editHistory} onEditHistoryActivity={editHistoryActivity} onDeleteHistory={deleteHistory} onReopenActivity={reopenActivity} onAddActivity={addActivity} onEditActivity={editActivity} onCompleteActivity={completeActivity} onDeleteActivity={deleteActivity} onEditField={editField} onManageFields={() => setShowFieldMgr(true)} onDeleteDeal={deleteDeal} />
      </div>
    );
  }

  // ---- Activities tab ------------------------------------------------------
  // Two sources, both already in memory: the imported outstanding list, and any activity
  // added by hand in the CRM (those live on the deal itself). Joined to the deal for the
  // project and customer company, and to the contacts list for email / phone.
  // ---- Acting on an activity from the Activities tab -----------------------
  // An activity lives in one of two places: imported ones sit in their own per-deal
  // store, manually-added ones sit on the deal. Both have to be handled, so these
  // helpers work out which it is and take the right route.
  const isManualActivity = (dealId, actId) => {
    const d = deals.find((x) => String(x.id) === String(dealId));
    return !!(d && (d.activities || []).some((a) => a.id === actId));
  };

  async function patchImportedActivity(dealId, actId, patch) {
    const got = await fetch('/api/crm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get-sub', kind: 'activities', dealId: String(dealId) }),
    }).then((r) => r.json());
    const items = (got.items || []).map((a) => a.id === actId ? { ...a, ...patch } : a);
    await fetch('/api/crm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save-sub', kind: 'activities', dealId: String(dealId), items }),
    });
  }

  // Mark done, record what happened on the deal's history, and optionally set the next one.
  async function completeActivityFromTable(row, outcome, next) {
    const dealId = row.dealId;
    pendingWrites.current++;
    try {
      // Take it off the list IMMEDIATELY, then do the saving behind it. Previously the row
      // sat there until two network round trips had finished - fetch the deal's
      // activities, write them back - which is the delay you were seeing. If the save
      // fails, it is put back and you are told.
      const removed = openActivities.filter((a) => String(a.dealId) === String(dealId) && a.id === row.rawId);
      setOpenActivities((prev) => prev.filter((a) => !(String(a.dealId) === String(dealId) && a.id === row.rawId)));

      if (isManualActivity(dealId, row.rawId)) {
        completeActivity(Number(dealId), row.rawId);
      } else {
        try {
          await patchImportedActivity(dealId, row.rawId, { done: true, doneAt: Date.now() });
        } catch (e) {
          if (removed.length) setOpenActivities((prev) => [...prev, ...removed]);   // put it back
          setSaveError('That activity could not be marked done - it has been put back.');
          throw e;
        }
      }

      if (outcome && outcome.trim()) {
        patch(Number(dealId), (d) => ({
          ...d,
          history: [...d.history, { id: uid(), type: 'activity', ts: nowIso(), text: `Activity completed: ${row.text}`, body: outcome.trim() }],
        }));
      }

      if (next && next.text && next.text.trim()) {
        addActivity(Number(dealId), next.text.trim(), next.due || today, next.assignee || null);
      }
    } catch (e) { console.error('Could not complete the activity:', e); }
    finally { pendingWrites.current = Math.max(0, pendingWrites.current - 1); }
  }

  // Edit the description (and due date / owner) from the table.
  async function editActivityFromTable(row, text, due, assignee) {
    const dealId = row.dealId;
    try {
      if (isManualActivity(dealId, row.rawId)) {
        patch(Number(dealId), (d) => ({
          ...d,
          activities: d.activities.map((a) => a.id === row.rawId ? { ...a, text, due, assignee: assignee || a.assignee || null } : a),
        }));
      } else {
        await patchImportedActivity(dealId, row.rawId, { subject: text, text, dueDate: due, assignee: assignee || '' });
        setOpenActivities((prev) => prev.map((a) => (String(a.dealId) === String(dealId) && a.id === row.rawId)
          ? { ...a, text, due, assignee: assignee || a.assignee } : a));
      }
    } catch (e) { console.error('Could not update the activity:', e); }
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

      {importOpen && (
        <div onClick={() => !importing && setImportOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 22, width: 480, maxWidth: '92vw', fontFamily: FONT }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 18, color: C.text }}>Import from Pipedrive</h2>
              {!importing && <button onClick={() => setImportOpen(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#999' }}>&times;</button>}
            </div>
            <p style={{ fontSize: 13, color: C.dim, marginTop: 0 }}>Upload a Pipedrive export - <strong>Deals</strong>, <strong>Organizations</strong>, or <strong>People</strong> (.xlsx or .csv). The type is detected automatically. Each import replaces that set (deals / companies / contacts) with the file's contents, matched by Pipedrive ID so re-importing never duplicates.</p>
            <input ref={importFileRef} type="file" accept=".xlsx,.xls,.csv" disabled={importing}
              onChange={(e) => handleImportFile(e.target.files && e.target.files[0])}
              style={{ display: 'block', width: '100%', fontSize: 13, margin: '10px 0' }} />
            {importMsg && <div style={{ fontSize: 13, marginTop: 8, padding: '8px 11px', borderRadius: 8, background: importMsg.startsWith('Imported') ? '#dcfce7' : '#eef2ff', color: importMsg.startsWith('Imported') ? '#166534' : '#3730a3' }}>{importing ? '' : ''}{importMsg}</div>}
            {importing && <div style={{ fontSize: 13, color: C.dim, marginTop: 8 }}>Working... this can take a moment for a large file.</div>}
          </div>
        </div>
      )}

      {/* black nav with Rock Roofing logo */}
      <div style={{ background: C.nav, color: '#fff', padding: '10px 16px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: .3, marginRight: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />Rock Roofing
        </span>
        <a href="/sales-crm" style={{ ...backBtn, background: 'transparent', color: '#fff', borderColor: '#444', textDecoration: 'none' }}>&larr; Pre-Contract</a>
        <span title={saveError || ''} style={{ fontSize: 11.5, color: saveError ? '#ff6b6b' : saving ? '#f5c518' : '#7ac57a', minWidth: 46, maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {!loaded ? '' : saveError ? saveError : saving ? 'Saving...' : 'Saved'}
        </span>
        {/* Import button removed - the Pipedrive import is done, and it is wipe-and-replace,
            so leaving it on the toolbar was a standing risk of wiping live data by
            accident. The import itself still works; put this line back to expose it. */}
        <div style={{ display: 'flex', border: `1px solid #444`, borderRadius: 6, overflow: 'hidden' }}>
          <button onClick={() => setView('pipeline')} style={segBtn(view === 'pipeline')}>Pipeline</button>
          <button onClick={() => setView('list')} style={segBtn(view === 'list')}>List</button>
        </div>
        {/* Companies / Contacts buttons to the LEFT of search */}
        <button onClick={() => setView('companies')} style={{ ...backBtn, background: view === 'companies' ? C.link : 'transparent', color: '#fff', borderColor: view === 'companies' ? C.link : '#444' }}>Companies</button>
        <button onClick={() => setView('contacts')} style={{ ...backBtn, background: view === 'contacts' ? C.link : 'transparent', color: '#fff', borderColor: view === 'contacts' ? C.link : '#444' }}>Contacts</button>
        <button onClick={() => setView('activities')} style={{ ...backBtn, background: view === 'activities' ? C.link : 'transparent', color: '#fff', borderColor: view === 'activities' ? C.link : '#444' }}>Activities</button>
        <EmailsNavButton active={view === 'emails'} onClick={() => setView('emails')} refreshKey={view} />
        <button onClick={resetView} title="Clear remembered filters, columns and sort" style={{ ...backBtn, color: '#aaa', borderColor: '#444', background: 'transparent' }}>Clear Filters</button>
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

      {/* Companies/Contacts: a thin bar with Choose Columns on the right.
          Was `!isDealView`, so it also appeared on the Activities tab labelled
          "Contacts (4,717)" with a Choose Columns button that opened the contacts
          chooser. Now it shows only where it means something. */}
      {(view === 'companies' || view === 'contacts') && (
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
        {view === 'companies' && <EntityTable rows={companyRows} fields={COMPANY_FIELDS} columns={companyCols} sort={entitySort} onSort={doEntitySort} onDelete={deleteCompany} noun="company" />}
        {view === 'contacts' && <EntityTable rows={contactRows} fields={CONTACT_FIELDS} columns={contactCols} sort={entitySort} onSort={doEntitySort} onDelete={deleteContact} noun="contact" />}
        {view === 'activities' && (
          <ActivitiesTable
            rows={activitiesShown} total={activityRows.length}
            people={actPeople} customers={actCustomers}
            person={actPerson} setPerson={setActPerson}
            customer={actCustomer} setCustomer={setActCustomer}
            showDone={actShowDone} setShowDone={setActShowDone}
            sort={actSort} onSort={(k) => setActSort((p) => p.key === k ? { key: k, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' })}
            today={today} onOpen={openDealById} loading={actLoading} summary={activitySummary}
            onComplete={completeActivityFromTable} onEdit={editActivityFromTable}
            staleFilter={activityStaleFilter}
            refreshedAt={actRefreshedAt} onRefresh={refreshActivityState}
            search={actSearch} setSearch={setActSearch} me={me} users={users}
            onClearFilters={() => { setActPerson(''); setActCustomer(''); }}
            deals={deals} openList={openActivities} dealsAreSeed={dealsAreSeed}
            onRetry={() => { healedRef.current = false; setActivitySummary((p) => ({ ...p })); }} />
        )}
        {view === 'emails' && <EmailQueue deals={deals} onOpenDeal={openDealById} />}
      </div>

      {showAdd && <AddProjectModal onClose={() => setShowAdd(false)} onCreate={createProject} users={users} />}
    </div>
  );
}

// ===========================================================================
// Add project modal
// ===========================================================================
function AddProjectModal({ onClose, onCreate, users }) {
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
    if (def.type === 'select') {
      // Estimator options come from the portal users, so the name on the deal matches the
      // person an activity can be assigned to.
      const opts = def.fromPortalUsers ? (users || []).map((u) => u.name) : (def.options || []);
      return <select value={f[k] || ''} onChange={(e) => set(k, e.target.value)} style={{ ...miniInput, width: '100%', boxSizing: 'border-box' }}><option value="">-</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
    }
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
          {fieldCell('expected_close_date','Tender return date', false)}
          <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: C.dim, marginTop: -4 }}>
            Setting this creates a &quot;Tender return&quot; activity, due that date, assigned to the Estimator Responsible.
          </div>
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

// ---------------------------------------------------------------------------
// Activities tab: every outstanding activity across the whole CRM, oldest due first.
// Sort by clicking a header; filter by person responsible and by customer company.
// ---------------------------------------------------------------------------
const ACT_COLS = [
  ['project', 'Project'],
  ['stage', 'Stage'],
  ['text', 'Activity'],
  ['due', 'Due date'],
  ['assignee', 'Person responsible'],
  ['company', 'Customer company'],
  ['customer', 'Customer name'],
  ['email', 'Customer email'],
  ['phone', 'Customer phone'],
];

// NOTE: the page body is a fixed-height flex child with overflow:hidden, so a table that
// simply grows tall is CUT OFF with no way to reach the rest. ListView and EntityTable
// each manage their own scrolling; this one has to do the same - hence the column layout
// with a scrollable table area and a header row that stays put.
function ActivitiesTable({ rows, total, people, customers, person, setPerson, customer, setCustomer, showDone, setShowDone, sort, onSort, today, onOpen, loading, summary, deals, openList, dealsAreSeed, onRetry, onComplete, onEdit, onClearFilters, staleFilter, refreshedAt, onRefresh, search, setSearch, me, users }) {
  const [completing, setCompleting] = useState(null);   // row being marked done
  const [editing, setEditing] = useState(null);         // row being edited in the big box
  const sel = { padding: '7px 10px', border: '1px solid ' + C.line, borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff' };
  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11.5, color: C.dim, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' };
  const td = { padding: '8px 10px', fontSize: 12.5, verticalAlign: 'top' };
  const arrow = (k) => <span style={{ fontSize: 8, marginLeft: 4, opacity: sort.key === k ? 1 : 0.3 }}>{sort.key === k && sort.dir === 'desc' ? '\u25BC' : '\u25B2'}</span>;

  const overdue = rows.filter((r) => r.due && r.due < today && !r.done).length;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, padding: 12, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, flexShrink: 0 }}>
        <select value={person} onChange={(e) => setPerson(e.target.value)} style={sel}>
          <option value="">All people</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={customer} onChange={(e) => setCustomer(e.target.value)} style={sel}>
          <option value="">All customers</option>
          {customers.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.dim, cursor: 'pointer' }}>
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Include completed
        </label>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search activities..."
          style={{ ...sel, minWidth: 200 }} />
        <button onClick={onRefresh} title="Check for activities added by other people" style={{ ...sel, cursor: 'pointer' }}>Refresh</button>
        {refreshedAt && <span style={{ fontSize: 11, color: '#aaa' }}>updated {new Date(refreshedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12.5, color: C.dim, textAlign: 'right' }}>
          <div>
            {rows.length}{rows.length !== total ? ` of ${total}` : ''} activit{rows.length === 1 ? 'y' : 'ies'}
            {overdue ? <span style={{ color: C.red, fontWeight: 700 }}> &middot; {overdue} overdue</span> : null}
          </div>
          {staleFilter && (
            <div style={{ color: '#b45309', marginTop: 2 }}>
              A saved filter matched nothing and has been ignored.{' '}
              <button onClick={onClearFilters} style={{ background: 'none', border: 'none', color: C.link, cursor: 'pointer', font: 'inherit', textDecoration: 'underline', padding: 0 }}>clear it</button>
            </div>
          )}
          {(person || customer) && !staleFilter && (
            <div style={{ color: '#b45309', marginTop: 2, fontWeight: 600 }}>
              Filtered by {[person && `person: ${person}`, customer && `customer: ${customer}`].filter(Boolean).join(', ')}
              {total > rows.length ? ` - hiding ${total - rows.length}` : ''}
              {' '}<button onClick={onClearFilters} style={{ background: 'none', border: 'none', color: C.link, cursor: 'pointer', font: 'inherit', textDecoration: 'underline', padding: 0 }}>clear</button>
            </div>
          )}
        </div>
      </div>

      {!rows.length ? (
        <EmptyActivities loading={loading} summary={summary} filtered={!!(person || customer)}
          deals={deals} openList={openList} dealsAreSeed={dealsAreSeed} onRetry={onRetry} />
      ) : (
        <div style={{ background: '#fff', border: '1px solid ' + C.line, borderRadius: 10, overflow: 'auto', flex: 1, minHeight: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
              <tr style={{ background: '#faf9f7', borderBottom: '1px solid ' + C.line }}>
                <th style={{ ...th, cursor: 'default', width: 78, whiteSpace: 'nowrap' }}>Mark Done</th>
                <th style={{ ...th, cursor: 'default', width: 60, whiteSpace: 'nowrap' }}>Edit</th>
                {ACT_COLS.map(([k, label]) => (
                  <th key={k} style={th} onClick={() => onSort(k)}>{label}{arrow(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOverdue = r.due && r.due < today && !r.done;
                const isToday = r.due === today && !r.done;
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid #f4f3f0', background: r.done ? '#fafafa' : '#fff' }}>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {!r.done && (
                        <button onClick={() => setCompleting(r)} title="Mark this activity done"
                          style={{ width: 20, height: 20, borderRadius: 4, border: '1.5px solid ' + C.dotGrey, background: '#fff', cursor: 'pointer', padding: 0 }} />
                      )}
                      {r.done && <span title="Completed" style={{ color: C.green, fontWeight: 700 }}>&#10003;</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <button onClick={() => setEditing(r)} title="Edit this activity"
                        style={{ background: 'none', border: '1px solid ' + C.line, borderRadius: 6, padding: '3px 9px', cursor: 'pointer', fontSize: 11.5, fontWeight: 600, color: C.link, fontFamily: 'inherit' }}>
                        Edit
                      </button>
                    </td>
                    <td style={td}>
                      <button onClick={() => onOpen(r.dealId)} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: C.link, cursor: 'pointer', textAlign: 'left' }}>{r.project}</button>
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: C.dim }}>{r.stage || '\u2014'}</td>
                    <td style={{ ...td, color: r.done ? C.dim : C.text, textDecoration: r.done ? 'line-through' : 'none' }}>{r.text}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: isOverdue ? C.red : isToday ? C.green : C.text, fontWeight: isOverdue || isToday ? 700 : 400 }}>
                      {shortDate(r.due)}{isOverdue ? ' \u00b7 OVERDUE' : ''}
                    </td>
                    <td style={td}>{r.assignee || '\u2014'}</td>
                    <td style={td}>{r.company || '\u2014'}</td>
                    <td style={td}>{r.customer || '\u2014'}</td>
                    <td style={td}>{r.email ? <a href={`mailto:${r.email}`} style={{ color: C.link }}>{r.email}</a> : '\u2014'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.phone ? <a href={`tel:${r.phone}`} style={{ color: C.link }}>{r.phone}</a> : '\u2014'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {completing && (
        <CompleteActivityModal row={completing} today={today}
          onClose={() => setCompleting(null)}
          onDone={(outcome, next) => { setCompleting(null); onComplete(completing, outcome, next); }} />
      )}
      {editing && (
        <EditActivityModal row={editing} me={me} users={users}
          onClose={() => setEditing(null)}
          onSave={(text, due, assignee) => { onEdit(editing, text, due, assignee); setEditing(null); }} />
      )}
    </div>
  );
}

// Marking done is the moment you know what happens next, so this captures the outcome and
// offers to set the follow-up in the same step rather than leaving the project with nothing
// booked - which is how deals go quiet.
function CompleteActivityModal({ row, today, onClose, onDone }) {
  const [outcome, setOutcome] = useState('');
  // Empty, with "Call" shown as grey placeholder text. So it reads as a prompt to write
  // something rather than a value already filled in - but leaving it alone still saves the
  // activity as "Call", which is the common case.
  const [nextText, setNextText] = useState('');
  // Blank on purpose - a due date has to be a deliberate choice, not today by default.
  const [nextDue, setNextDue] = useState('');
  const [dueWarning, setDueWarning] = useState('');
  const [nextAssignee, setNextAssignee] = useState(row.assignee || '');
  const inp = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid ' + C.line, borderRadius: 8, fontSize: 13.5, fontFamily: 'inherit' };
  const lbl = { fontSize: 12, fontWeight: 700, color: C.dim, display: 'block', marginBottom: 5 };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 600, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 620, maxWidth: '100%', padding: 22 }}>
        <h3 style={{ margin: '0 0 2px', fontSize: 17 }}>Complete activity</h3>
        <div style={{ fontSize: 13, color: C.dim, marginBottom: 16 }}>{row.project} &middot; {row.text}</div>

        <label style={lbl}>What happened? (call notes, email summary, outcome)</label>
        <textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={6}
          placeholder="Spoke to..., agreed..., they will..." style={{ ...inp, resize: 'vertical' }} />
        <div style={{ fontSize: 11.5, color: '#aaa', marginTop: 5 }}>Saved to the project&apos;s history against this activity.</div>

        <div style={{ borderTop: '1px solid ' + C.line, margin: '18px 0 14px' }} />

        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Set the next activity</div>
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 10 }}>Leave it and the next activity is set as a Call. Use &quot;Just mark done&quot; to set nothing at all.</div>
        <label style={lbl}>What needs doing next?</label>
        <input value={nextText} onChange={(e) => setNextText(e.target.value)}
          placeholder="Call" style={inp} />
        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Due</label>
            <input type="date" value={nextDue} onChange={(e) => { setNextDue(e.target.value); if (e.target.value) setDueWarning(''); }}
              style={{ ...inp, borderColor: dueWarning ? C.red : C.line }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Person responsible</label>
            <input value={nextAssignee} onChange={(e) => setNextAssignee(e.target.value)} placeholder="Who is doing it?" style={inp} />
          </div>
        </div>

        {dueWarning && (
          <div style={{ marginTop: 12, color: C.red, fontSize: 13, fontWeight: 600 }}>{dueWarning}</div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={() => onDone(outcome, null)} style={ghostBtn}>Just mark done</button>
          <button
            onClick={() => {
              // Deliberately NOT disabled. A greyed-out button tells you nothing about why
              // it will not work - this says what is missing.
              if (!nextDue) { setDueWarning('Next due date must be set.'); return; }
              onDone(outcome, { text: nextText.trim() || 'Call', due: nextDue, assignee: nextAssignee });
            }}
            style={primaryBtn}>
            Done &amp; set next
          </button>
        </div>
      </div>
    </div>
  );
}

// Clicking the activity text opens this - a full-size box, because these are call and email
// notes, not a one-line label squeezed into a table cell.
function EditActivityModal({ row, onClose, onSave, me, users }) {
  const [text, setText] = useState(row.text || '');
  const [due, setDue] = useState(row.due || '');
  const [assignee, setAssignee] = useState(row.assignee || '');
  const inp = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid ' + C.line, borderRadius: 8, fontSize: 13.5, fontFamily: 'inherit' };
  const lbl = { fontSize: 12, fontWeight: 700, color: C.dim, display: 'block', marginBottom: 5 };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 600, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 680, maxWidth: '100%', padding: 22 }}>
        <h3 style={{ margin: '0 0 2px', fontSize: 17 }}>Edit activity</h3>
        <div style={{ fontSize: 13, color: C.dim, marginBottom: 16 }}>{row.project}</div>

        <label style={lbl}>Activity</label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9}
          placeholder="What needs doing, or what was discussed on the call / in the email..."
          style={{ ...inp, resize: 'vertical' }} />

        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Due</label>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={inp} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Person responsible</label>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} style={inp}>
              {/* Free text before - which is how names like "James" ended up alongside
                  "James McVeigh". Restricted to the same people you can pick anywhere else. */}
              <option value="">Nobody</option>
              {me?.name && <option value={me.name}>{me.name} (you)</option>}
              {(users || []).filter((u) => u.name !== me?.name).map((u) => <option key={u.username || u.name} value={u.name}>{u.name}</option>)}
              {assignee && !(users || []).some((u) => u.name === assignee) && assignee !== me?.name &&
                <option value={assignee}>{assignee} (no longer available)</option>}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={() => onSave(text, due, assignee)} disabled={!text.trim()}
            style={{ ...primaryBtn, opacity: text.trim() ? 1 : 0.5 }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// An empty table is ambiguous - nothing imported, or nothing outstanding? This works it
// out from the per-deal summary and says which, so nobody has to guess whether the import
// failed.
function EmptyActivities({ loading, summary, filtered, deals, openList, dealsAreSeed, onRetry }) {
  const box = { background: '#fff', border: '1px solid ' + C.line, borderRadius: 10, padding: 28, textAlign: 'center', fontSize: 13.5, color: C.dim };
  if (loading) return <div style={box}>Loading activities...</div>;

  const vals = Object.values(summary || {});
  const projects = vals.length;
  const totalActs = vals.reduce((n, v) => n + (v?.total || 0), 0);
  const openActs = vals.reduce((n, v) => n + (v?.open || 0), 0);

  if (filtered) {
    return <div style={box}>No activities match those filters.<div style={{ fontSize: 12, marginTop: 6, color: '#aaa' }}>Clear the person or customer filter to see the rest.</div></div>;
  }

  if (!totalActs) {
    return (
      <div style={box}>
        No activities have been imported yet.
        <div style={{ fontSize: 12, marginTop: 6, color: '#aaa' }}>
          Import your Deals export first, then the Activities export.
        </div>
      </div>
    );
  }

  if (!openActs) {
    return (
      <div style={box}>
        <div style={{ color: C.text, fontWeight: 600 }}>
          {totalActs.toLocaleString('en-GB')} activities are imported across {projects.toLocaleString('en-GB')} projects &mdash; but every one is marked complete.
        </div>
        <div style={{ fontSize: 12.5, marginTop: 10, color: '#888', maxWidth: 560, margin: '10px auto 0', lineHeight: 1.6 }}>
          So there is nothing outstanding to list. The import worked; the file simply
          contained no activities that were still to do.
          <br /><br />
          In Pipedrive, open the Activities list, set the filter to include activities that
          are NOT done, and export again. Before uploading, open the file and check the
          <strong> Done</strong> column has a mix of values rather than saying
          &quot;Done&quot; on every row. Export everything in one go, not just the
          outstanding ones - the import replaces what is there.
        </div>
      </div>
    );
  }

  // Unmatched: show the evidence rather than guessing at the cause. Nine times out of ten
  // the two lists of ids make the reason obvious at a glance.
  const dealSample = (deals || []).slice(0, 5).map((d) => String(d.id));
  const actSample = (openList || []).slice(0, 5).map((a) => String(a.dealId));
  const code = { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, color: C.text };
  return (
    <div style={{ ...box, textAlign: 'left' }}>
      <div style={{ color: C.text, fontWeight: 600, textAlign: 'center' }}>
        {openActs.toLocaleString('en-GB')} outstanding activities found, but none of them match a project in the CRM.
      </div>
      {dealsAreSeed && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '10px 14px', margin: '14px 0', fontSize: 12.5, color: '#9a3412' }}>
          <strong>The CRM is showing the built-in sample deals, not your imported ones.</strong> That is
          the cause: the activities point at your real projects, which are not loaded. Import your
          Deals export and this will resolve itself.
        </div>
      )}
      <div style={{ fontSize: 12.5, color: '#888', marginTop: 14, lineHeight: 1.7 }}>
        <div>Deals currently loaded: <strong style={code}>{(deals || []).length.toLocaleString('en-GB')}</strong></div>
        <div>Their ids look like: <span style={code}>{dealSample.join(', ') || '(none)'}</span></div>
        <div style={{ marginTop: 6 }}>The activities are attached to deal ids: <span style={code}>{actSample.join(', ') || '(none)'}</span></div>
        {!(openList || []).length && (
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <button onClick={onRetry} style={{ ...primaryBtn }}>Load activities</button>
            <div style={{ fontSize: 11.5, color: '#aaa', marginTop: 6 }}>
              The activity list is empty rather than mismatched. This fetches it from the imported data.
            </div>
          </div>
        )}
        <div style={{ marginTop: 10, color: '#aaa' }}>
          If both sets of numbers are shown and look like different things, the deals and the
          activities came from different exports. If they look the same, send me this screen.
        </div>
      </div>
    </div>
  );
}
