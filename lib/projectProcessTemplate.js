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
export function buildCardsForProject() {
  return ROLE_CARDS.map((rc, ri) => ({
    id: `card_${ri}_${Math.random().toString(36).slice(2, 8)}`,
    role: rc.role,
    dueDate: '',
    assignee: '',       // portal user id
    assigneeName: '',
    notes: '',
    items: rc.items.map((text, i) => ({ id: `it_${ri}_${i}_${Math.random().toString(36).slice(2, 6)}`, text, done: false })),
    chat: [],           // [{ id, authorId, authorName, text, ts, mentions:[userId] }]
  }))
}
