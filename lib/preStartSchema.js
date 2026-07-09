// ───────────────────────────────────────────────────────────────────────────
// Pre-Start Meeting Minutes — schema
//
// Mirrors Rock Roofing's Pre-Start Meeting Minutes Word template. Completed in
// the portal against an existing project (keyed by RR Project Number). Feels
// like the Internal Handover Minutes: sectioned, editable, read-only view.
//
// Field types:
//   team    - team-member picker (role-filtered)
//   date    - date
//   text    - single line
//   long    - multi-line
//   attendees - repeatable rows (role, name, email, phone)
//   qrow    - a question row: { resolved: 'Y'|'N'|'', comments: '' }
//             `ai: true` marks rows that support an AI "Suggest" button later.
// ───────────────────────────────────────────────────────────────────────────

export const PRESTART_SECTIONS = [
  {
    id: 'meeting',
    title: 'Meeting Details',
    noCustom: true,
    fields: [
      { id: 'meetingDate', label: 'Date of Meeting', type: 'date' },
      { id: 'completedBy', label: 'Completed by', type: 'team' },
      { id: 'attendeesRock', label: 'Rock Roofing Attendees', type: 'attendeesRock' },
      { id: 'attendeesCustomer', label: "Customer's Team", type: 'attendees' },
    ],
  },
  {
    id: 'scope',
    title: 'Scope of Works',
    fields: [
      { id: 'scopeFiles', label: 'Project drawings & documents', type: 'files', help: 'Upload drawings/documents run through in the meeting. These embed as viewable pages in the sent PDF.' },
      { id: 'scopeConfirm', label: 'Confirm the Scope of our Works and run through project drawings.', type: 'qrow', ai: true },
      { id: 'scopeDesign', label: 'Re-Confirm any design issues and resolutions. Are there any outstanding items relating to design that need to be discussed?', type: 'qrow', ai: true },
      { id: 'scopeCoord', label: 'Re-Confirm any co-ordination issues and resolutions. Are there any outstanding coordination issues that need to be discussed?', type: 'qrow', ai: true },
      { id: 'scopeInterfacing', label: 'Do we need any contact details of interfacing trades so that we can coordinate our works more effectively?', type: 'qrow' },
      { id: 'scopeHS', label: 'Re-Confirm H&S issues and resolutions. Are there any outstanding areas of work that may present a H&S risk?', type: 'qrow', ai: true },
      { id: 'scopeRiskLog', label: 'Are there any outstanding items from the Risk Log within the Internal Handover Meeting Minutes that need to be discussed?', type: 'qrow', ai: true },
    ],
  },
  {
    id: 'programme',
    title: 'Programme',
    fields: [
      { id: 'progPhasing', label: 'How are the works set to be phased? Any changes from what was originally agreed?', type: 'qrow', ai: true },
      { id: 'progStartDates', label: 'What are the anticipated start dates for all phases of the works? Any changes from what was originally agreed?', type: 'qrow' },
      { id: 'progLatest', label: 'Do we have the latest project programme available?', type: 'qrow' },
      { id: 'progMCAdvised', label: 'Has the Main Contractor been advised of the importance of hitting dates?', type: 'qrow' },
      { id: 'progInternal', label: 'Are there any internal works starting before we have completed the roofing / cladding works?', type: 'qrow' },
    ],
  },
  {
    id: 'deliveries',
    title: 'Deliveries',
    fields: [
      { id: 'delRestrictions', label: 'Re-confirm delivery restrictions.', type: 'qrow' },
      { id: 'delForklift', label: 'Who is responsible for providing forklift for offloading? (Moffit offloading to be charged as a variation if required.)', type: 'qrow' },
      { id: 'delPhasing', label: 'Re-confirm material delivery phasing.', type: 'qrow' },
      { id: 'delDistribution', label: 'Re-confirm method of distribution for materials across the site.', type: 'qrow' },
      { id: 'delLaydown', label: 'Re-confirm laydown location and area size required.', type: 'qrow' },
      { id: 'delMCAccept', label: 'Will the Main Contractor accept deliveries on our behalf?', type: 'qrow' },
    ],
  },
  {
    id: 'lifting',
    title: 'Lifting',
    fields: [
      { id: 'liftMethod', label: 'Re-confirm how we are getting materials up onto the roof / walls.', type: 'qrow' },
      { id: 'liftLogistics', label: 'Are there any outstanding logistical issues?', type: 'qrow' },
    ],
  },
  {
    id: 'attendancesOther',
    title: 'Attendances (Other)',
    fields: [
      { id: 'attPower', label: 'Re-Confirm power provision.', type: 'qrow' },
      { id: 'attNetting', label: 'Re-confirm any requirement for Safety Netting.', type: 'qrow' },
      { id: 'attScaffold', label: 'Re-confirm scaffold / edge protection provision.', type: 'qrow' },
    ],
  },
  {
    id: 'commercial',
    title: 'Commercial',
    fields: [
      { id: 'commVarInstruct', label: 'Are there any outstanding variations that need instructing?', type: 'qrow', ai: true },
      { id: 'commVarPrice', label: 'Are there any outstanding variations that need to be priced?', type: 'qrow', ai: true },
    ],
  },
  {
    id: 'rams',
    title: 'RAMS (H&S) related',
    fields: [
      { id: 'ramsAccess', label: 'How exactly are we accessing the site? (Street, alley, front, back, gate no, etc.)', type: 'qrow' },
      { id: 'ramsParking', label: 'Is there parking available and where?', type: 'qrow' },
      { id: 'ramsRoofAccess', label: 'What is the safe roof / elevation access methodology?', type: 'qrow' },
      { id: 'ramsInductions', label: 'What time, where and how are site inductions held? If online, provide web address and login instructions.', type: 'qrow' },
      { id: 'ramsStorage', label: 'If necessary, can tools and equipment be stored overnight and where?', type: 'qrow' },
      { id: 'ramsFirstAider', label: 'Is there a qualified first aider on site? Who?', type: 'qrow' },
      { id: 'ramsWelfare', label: 'What welfare facilities are provided on site?', type: 'qrow' },
      { id: 'ramsLiveServices', label: 'Are there any live services that we need to be made aware of?', type: 'qrow' },
      { id: 'ramsBirds', label: 'Are there excessive bird faeces on roof / facade? (If applicable)', type: 'qrow' },
    ],
  },
  {
    id: 'commonIssues',
    title: 'Common and other Issues to be discussed',
    // These carry standard Rock Roofing guidance text as the default comment.
    fields: [
      { id: 'ciWeepholes', label: 'Weepholes, grinding out, mortar left out', type: 'qrow', default: 'Mortar to be left out by others. Grinding joint destroys the DPC. Bricklayers must use foam fillers and leave mortar out to remove future waterproofing risk. Rock Roofing are not responsible for water ingress if mortar is required to be ground out.' },
      { id: 'ciThresholds', label: 'Door thresholds', type: 'qrow', default: 'Minimum 75mm required to door thresholds for waterproofing system.' },
      { id: 'ciBalustrade', label: 'Balustrade posts', type: 'qrow', default: 'Balustrade posts must have a weathering cravat by others for fully compliant details.' },
      { id: 'ciUpstands', label: 'General upstands', type: 'qrow', default: 'Minimum upstand height required is 150mm.' },
      { id: 'ciCementitious', label: 'Cementitious board', type: 'qrow', default: 'Where cementitious board is installed to upstands or the main roof area, we are unable to mechanically fix to this substrate. Another substrate must be considered if mechanical fixing is required.' },
      { id: 'ciParapet', label: 'Parapet cappings', type: 'qrow', default: 'Any cantilever cappings to be reviewed and discussed.' },
      { id: 'ciDebris', label: 'Debris and scaffold on roof system', type: 'qrow', default: 'No scaffold or debris to be left on our roof system to mitigate the risk of unnecessary damage.' },
      { id: 'ciProtection', label: 'Protection layer', type: 'qrow', default: 'All items including but not limited to M&E, PV, handrails, decking, paving, ballast, and the like must have protection layer loose laid between the roof system and the roof top item.' },
      { id: 'ciInterfacing', label: 'Interfacing trades', type: 'qrow', default: 'Any works to our roof system by interfacing trades should be discussed with Rock Roofing and / or the roof system manufacturer to ensure compatibility with the roof system. A failure to do so could invalidate the roof warranty.' },
      { id: 'ciHarness', label: 'Harness Working', type: 'qrow', default: 'It is company policy that we do not work off harnesses. Please ensure that the handrail remains in place for the duration of all roofing work. This includes but is not limited to all penetrations, cappings, protection layer, lightning protection tabs, leak tests, M&E weathering, louvre post interface and the like. Weathering of these items must be coordinated before safe access and handrails are removed.' },
    ],
  },
  {
    id: 'designApprovals',
    title: 'Design Approvals',
    fields: [
      { id: 'daTechApproval', label: 'Has the Technical Approval Form been signed and returned?', type: 'qrow', default: 'Notices to Commence are only valid if the Technical Approval Form has been signed by the person responsible for design and returned to Rock Roofing. After this has been received, checked, and accepted by Rock Roofing, only then will the timeline for the Notice to Commence begin.' },
      { id: 'daResend', label: 'If no to the above, does this document need re-sending?', type: 'qrow' },
      { id: 'daOtherApproval', label: 'Are there any other items that still require approval?', type: 'qrow', default: 'We are unable to commence procurement without formal approval of all design items.' },
    ],
  },
]

// Flat list of all field ids that support AI suggestions (for later wiring).
export const PRESTART_AI_FIELDS = PRESTART_SECTIONS.flatMap(s => s.fields.filter(f => f.ai).map(f => f.id))
