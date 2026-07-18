// Parser for Rock Roofing "TAKE OFF" costings / contract-rates workbooks.
//
// Column map (1-indexed as in the sheet, 0-indexed in the row arrays SheetJS gives us):
//   A (0)  Schedule ID   -> code
//   E (4)  Qty
//   F (5)  Unit
//   G (6)  Description
//   H (7)  Complete Rate
//   I (8)  Complete Total          ("Rate only" for below-the-line items)
//   J (9)  Materials rate (budget)
//   L (11) Labour rate (budget)
//
// The sheet lists contract works ("above the line"), then a divider row whose
// description contains "BELOW THE LINE ITEMS", then optional/variation items
// ("below the line"). Rows with a description but no qty/rate are section
// headings (e.g. "Main Roof Area"). Validated: the sum of above-the-line item
// totals matches the sheet's own total row (£92,200.84 on Bradford Works).

function toNum(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return isNaN(v) ? null : v
  const n = parseFloat(String(v).replace(/[£,\s]/g, ''))
  return isNaN(n) ? null : n
}

// rows = array of row-arrays (SheetJS sheet_to_json with { header: 1 }).
export function parseTakeOffRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return { error: 'Empty sheet' }
  // Header row = the one whose column G (index 6) contains "DESCRIPTION".
  const headerIdx = rows.findIndex(r => r && String(r[6] || '').toUpperCase().includes('DESCRIPTION'))
  if (headerIdx === -1) return { error: 'Could not find the header row (no "DESCRIPTION" column).' }

  const items = []
  let below = false
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r) continue
    const desc = String(r[6] == null ? '' : r[6]).trim()
    const descU = desc.toUpperCase()
    if (descU.includes('BELOW THE LINE')) { below = true; continue }
    if (descU.includes('GROSS MARGIN SUMMARY')) continue

    const code = r[0] == null ? '' : String(r[0]).trim()
    const qty = toNum(r[4])
    const unit = String(r[5] == null ? '' : r[5]).trim()
    const rate = toNum(r[7])
    const total = toNum(r[8])
    const matRate = toNum(r[9])
    const labRate = toNum(r[11])
    const rawTotalCell = String(r[8] == null ? '' : r[8]).trim()
    // Non-numeric text in the total column (e.g. "Rate only", "TBC", "P.O.A") is
    // preserved verbatim. Such a line uses totalMode 'text'; a numeric line uses
    // 'calc' (total = qty x rate, editable later).
    const totalIsText = rawTotalCell !== '' && toNum(r[8]) == null
    const totalMode = totalIsText ? 'text' : 'calc'
    const totalText = totalIsText ? rawTotalCell : ''
    const rateOnly = /rate only/i.test(rawTotalCell)

    // Only include lines that carry an item code in column A (a number or a
    // letter). Everything else — blank spacer rows and sub-total lines with no
    // code — is skipped.
    if (!code) continue

    // Heading = has a description but no qty, rate or total (and isn't a text-total line).
    const kind = (desc && qty == null && rate == null && total == null && !totalIsText) ? 'heading' : 'item'

    items.push({
      id: `cr_${i}_${Math.random().toString(36).slice(2, 6)}`,
      code, qty, unit, description: desc,
      rate, total,
      totalMode, totalText,
      matRate, labRate,
      rateOnly,
      section: below ? 'below' : 'above',
      kind,
      struck: false,
    })
  }
  if (!items.length) return { error: 'No rate lines found in the sheet.' }
  return { items }
}

// Per-line value helpers (shared by page + server).
// A line's rate total is its calc value (qty x rate) unless it's a text line
// (TBC / Rate only), which contributes 0 to numeric sums.
export function lineRateTotal(x) {
  if (!x || x.kind !== 'item') return 0
  if (x.totalMode === 'text') return 0
  if (x.total != null && (x.qty == null || x.rate == null)) return x.total
  return (x.qty || 0) * (x.rate || 0)
}
export function lineMatTotal(x) {
  if (!x || x.kind !== 'item') return 0
  return (x.qty || 0) * (x.matRate || 0)
}
export function lineLabTotal(x) {
  if (!x || x.kind !== 'item') return 0
  return (x.qty || 0) * (x.labRate || 0)
}

// Sum a list of items (already filtered by caller) into rate/materials/labour.
export function sumItems(items) {
  const list = (Array.isArray(items) ? items : []).filter(x => x.kind === 'item' && !x.struck)
  return {
    rate: list.reduce((s, x) => s + lineRateTotal(x), 0),
    materials: list.reduce((s, x) => s + lineMatTotal(x), 0),
    labour: list.reduce((s, x) => s + lineLabTotal(x), 0),
    count: list.length,
  }
}

// Compute section totals from a full list of items.
export function computeRateTotals(items) {
  const list = Array.isArray(items) ? items : []
  const above = sumItems(list.filter(x => x.section === 'above'))
  const below = sumItems(list.filter(x => x.section === 'below'))
  return {
    aboveTotal: above.rate,
    belowTotal: below.rate,
    aboveMaterials: above.materials,
    aboveLabour: above.labour,
    belowMaterials: below.materials,
    belowLabour: below.labour,
    aboveCount: above.count,
    belowCount: below.count,
  }
}
