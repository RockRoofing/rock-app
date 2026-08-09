// Standard role cards + checklists for the Project Process board.
// When a project is added to the board (auto for new projects, or manually for existing
// ones), each of these role cards is created with this checklist. The lists are editable
// and moveable per project afterwards - this is only the starting template.

export const ROLE_CARDS = [
  {
    role: 'Commercial',
    items: [
      'Have Estimators reviewed the contracted scope of works?',
      'Contract Review',
      'Agree Contract Terms',
      'Contracted Rates',
      'Confirm with the customer / team what variations below the line, if any, are required?',
      'Add any variations to the Variations Tracker and the Planner',
      'Place Sub-Contracts with Labour (If Required)',
      'Set Up Application Document',
      'Scope of Works Review with Estimator (If Required)',
      'Has the Procurement Savings document been updated with the buying savings made?',
      "Send email with PDF'd procurement saving page to Directors showing all buying savings",
    ],
  },
  {
    role: 'Ops Manager',
    items: [
      'Set Up Project',
      'Order Acknowledgement',
      'Do we have the programme dates confirmed?',
      'Chase customer for Project Programme',
      'Set up Pre Start Meeting',
      'Add project to Programme Overview and insert programme completion date',
      'Add programme info to SRAPs including completion date',
      'Operatives Assigned',
      'Check labour have appropriate training',
      'RAMS',
      'RAMS Signed',
      'Toolbox Talk',
      'Send PSN to the Client',
      'Check Start On Site Checklist has been completed',
    ],
  },
  {
    role: 'Contracts Manager',
    items: [
      'Scope of Works Review / Understanding the Project',
      'Initial Procurement',
      'Pre-Start Meeting',
      'Initial Site Visit',
      'Labour Planning',
      'Assessing of new labour (If Applicable)',
      'Reviewing POs to check orders are correct.',
      'Pre-Start Notification',
      'Print out and give hard copy document pack for installation team',
      'Do installers have Rock Roofing Hi-Vis Vests?',
      'Start On Site Checklist',
      'H&S Internal Audit',
      'Google Review',
      'Has the Procurement Savings document been updated with the buying savings made?',
    ],
  },
  {
    role: 'Technical Manager',
    items: [
      'Scope of Works Refresh with Estimator (If Required)',
      'Familiarisation of Project',
      'Design Meeting (If Required)',
      'Arrange meeting to run through drawings for review and approval to Estimators, CMs',
      'Identification of Variations',
      'Technical Submittal',
      'Drawings',
      'Tech Sub Approval',
      'Design Approvals',
    ],
  },
  {
    role: 'Project Close Down',
    items: [
      'Project Audit - OM',
      'Customer Feedback - OM',
      'Practical Completion Notice - OM',
      'Warranty Issued - OM',
      'As Built and O&Ms - OM',
      'Final Account - QS',
    ],
  },
]

// Build the fresh set of cards for a newly-added project.
export function buildCardsFromTemplate(roleCards) {
  return (roleCards || ROLE_CARDS).map((rc, ri) => ({
    id: `card_${ri}_${Math.random().toString(36).slice(2, 8)}`,
    role: rc.role,
    dueDate: '',
    assignee: '',       // portal user id
    assigneeName: '',
    notes: '',
    items: (rc.items || []).map((text, i) => ({ id: `it_${ri}_${i}_${Math.random().toString(36).slice(2, 6)}`, text, done: false })),
    chat: [],           // [{ id, authorId, authorName, text, ts, mentions:[userId] }]
  }))
}

// Synchronous version kept for backwards-compatibility (uses the built-in defaults).
export function buildCardsForProject() {
  return buildCardsFromTemplate(ROLE_CARDS)
}

// ---- Editable template stored in the DB (falls back to the built-in ROLE_CARDS) ----
// Stored at 'ops:project-process-template' as [{ role, items:[string] }].
const TEMPLATE_KEY = 'ops:project-process-template'

export async function getProcessTemplate(get) {
  const saved = await get(TEMPLATE_KEY)
  if (Array.isArray(saved) && saved.length) return saved
  // Return a deep copy of the defaults so callers can't mutate the constant.
  return ROLE_CARDS.map(rc => ({ role: rc.role, items: [...rc.items] }))
}

export async function saveProcessTemplate(set, template) {
  // Sanitise: array of { role:non-empty string, items:[non-empty strings] }.
  const clean = (Array.isArray(template) ? template : [])
    .map(rc => ({ role: String(rc.role || '').trim(), items: (Array.isArray(rc.items) ? rc.items : []).map(t => String(t || '').trim()).filter(Boolean) }))
    .filter(rc => rc.role)
  await set(TEMPLATE_KEY, clean)
  return clean
}

// Build cards for a new project using the SAVED template (or defaults if none saved).
export async function buildCardsForProjectAsync(get) {
  const tmpl = await getProcessTemplate(get)
  return buildCardsFromTemplate(tmpl)
}
