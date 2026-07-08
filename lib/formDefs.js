// ───────────────────────────────────────────────────────────────────────────
// Rock Roofing — Form Definitions (seed data)
//
// Forms are DATA, not hardcoded pages. One renderer (pages/forms/fill) reads
// any definition in this shape and displays it. The Ops portal form builder
// can create/edit these and save them to Redis (ops:forms), which overrides
// this seed. This file guarantees the real forms exist on first run.
//
// Field types supported by the renderer:
//   'section'    — a titled group header (not an input)
//   'shorttext'  — single-line text
//   'longtext'   — multi-line text
//   'date'       — date picker
//   'single'     — choose ONE option (radio)
//   'multi'      — choose MANY options (checkbox list)
//   'yesno'      — shorthand single-select Yes/No
//   'photos'     — one or more photo uploads (camera on mobile)
//   'signature'  — name + date + drawn signature
//   'note'       — read-only guidance text shown to the operative
//
// Field options:
//   { id, type, label, required, options?, help?, notifyOn?, mandatory? }
//   notifyOn: value that, when selected, flags "call a manager" style urgency.
// ───────────────────────────────────────────────────────────────────────────

export const CATEGORIES = [
  { id: 'company', label: 'Company Information', desc: 'Policies, insurances & standard documents' },
  { id: 'guidance', label: 'Operative Guidance Documents', desc: 'How-to guides & best practice' },
  { id: 'project', label: 'Project Forms', desc: 'Site diaries, reports & handovers' },
]

const WEATHER_OPTS = [
  'Sunny, extremely hot', 'Sunny and clear', 'Cloudy / Overcast', 'Rain showers',
  'Light but persistent rain', 'Torrential rain and/or hail', 'Somewhat windy',
  'Medium to strong wind', 'Extremely strong wind', 'Sunny, but cold and icy',
  'Misty, cold and icy', 'Light snowfall', 'Snowstorm / Blizzard',
]

const SITE_COND_OPTS = [
  'Dry and clean - Works can proceed as planned.',
  'Somewhat wet - Works can be done.',
  'Wet - Some works possible but overall difficult.',
  'Very wet - No works can be done!',
  'Frozen (dry) - Slow progress possible.',
  'Snow cover - No works can be done!',
  'Very strong wind - Work extremely difficult!',
  "Other trades or others' materials on roof area - limited working space, works delayed.",
  'Debris or waste on roof area - works delayed until roof area is cleared.',
  'Roof area unsecure. H&S hazard present - DO NOT WORK!',
  'Site closed by Client / Site Management - No works can be done!',
]

const HS_ISSUE_OPTS = [
  'No H&S concerns', 'Inadequate H&S communication with site management',
  'Bad housekeeping / badly stored materials', 'Use of ladders',
  'Inadequate lifting equipment', 'Malfunctioning electric power tools',
  'Manual handling', 'Insufficient or inappropriate edge protection',
  'Unsafe plant equipment', 'No internal scaffold or fall protection',
  'Inadequate welfare facilities', 'Inadequate PPE', 'Slips, trips and falls',
  'Exposed or dangerously located live services', 'Potential fire hazard',
  'Hazard coming from other trades', 'Waste and/or hazardous waste on work area',
  'Bad weather conditions', "Access to site and works area has changed or isn't safe",
  'Proximity to the public',
]

// ── Daily Site Diary — Operatives ──────────────────────────────────────────
const dailySiteDiary = {
  id: 'daily-site-diary',
  category: 'project',
  title: 'Daily Site Diary — Operatives',
  short: 'Daily record of works, conditions, H&S and quality on site.',
  fields: [
    { id: 's_general', type: 'section', label: 'General Information' },
    { id: 'diaryDate', type: 'date', label: 'Site Diary Date', required: true },
    { id: 'yourName', type: 'shorttext', label: 'Insert your name', required: true },
    { id: 'personnel', type: 'longtext', label: 'Personnel on site working on behalf of Rock', required: true },
    { id: 'weather', type: 'multi', label: 'Weather conditions', options: WEATHER_OPTS },
    { id: 'siteConditions', type: 'multi', label: 'Site conditions', options: SITE_COND_OPTS },

    { id: 's_call', type: 'section', label: 'Daily Management Call' },
    { id: 'dailyCall', type: 'single', label: 'Have you had your daily call with the Rock Roofing Contracts Manager?', options: ['Yes', 'No'], notifyOn: 'No', required: true },

    { id: 's_var', type: 'section', label: 'Variations' },
    { id: 'variations', type: 'single', label: 'Have you identified any Variations from the Contract Works?', options: ['Yes - I will call a Rock Roofing Manager now to discuss', 'No'], notifyOn: 'Yes - I will call a Rock Roofing Manager now to discuss', required: true },

    { id: 's_mat', type: 'section', label: 'Materials' },
    { id: 'materials', type: 'single', label: 'Are there any materials that you need to ensure works can progress efficiently?', options: ['Yes - I will call / message Rock Roofing Management now', 'No - I have everything I need for the next week minimum'], notifyOn: 'Yes - I will call / message Rock Roofing Management now', required: true },

    { id: 's_delay', type: 'section', label: 'Delay and Disruption' },
    { id: 'delay', type: 'single', label: 'Have you experienced anything that has or will cause you delay?', options: ['Yes - I will raise a separate Issue Form now', 'No'], notifyOn: 'Yes - I will raise a separate Issue Form now', required: true },

    { id: 's_safety', type: 'section', label: 'We Only Accept Absolute Safety: Zero Accidents' },
    { id: 'ramsSigned', type: 'single', label: 'Have all operatives digitally signed the latest copy of the RAMS?', options: ['Yes', "No - I have instructed all operatives who haven't signed the RAMS to not work on site until they have digitally signed the RAMS"], notifyOn: "No - I have instructed all operatives who haven't signed the RAMS to not work on site until they have digitally signed the RAMS", required: true },
    { id: 'ramsReflect', type: 'single', label: 'Do the RAMS still reflect site conditions?', options: ['Yes', 'No - I have instructed everyone to stop works until the RAMS have been updated and digitally signed by all operatives'], notifyOn: 'No - I have instructed everyone to stop works until the RAMS have been updated and digitally signed by all operatives', required: true },
    { id: 'hsIssues', type: 'multi', label: 'Please select which options best describe any H&S issues encountered.', options: HS_ISSUE_OPTS },
    { id: 'weatherSecure', type: 'single', label: 'MANDATORY - Have we considered weather conditions when securing both loose and fixed materials?', options: ['Yes - have ensured all fixed and unfixed materials are secure with no risk of blowing off the roof or unnecessary water ingress'], mandatory: true, required: true },
    { id: 'hsConcern', type: 'single', label: 'Have you identified any H&S concerns?', options: ['Yes - I will raise a separate issue form now', 'No'], notifyOn: 'Yes - I will raise a separate issue form now', required: true },

    { id: 's_quality', type: 'section', label: 'We Are Quality Obsessed: Zero Defects' },
    { id: 'otherTrades', type: 'longtext', label: 'Are there other trades working on/in our works area? Describe what trades are working on our roof / in proximity to our cladding works area highlighting any concerns.' },
    { id: 'qualityConcern', type: 'single', label: 'Have you identified any quality concerns?', options: ['Yes - I will complete a separate issue form now', 'No'], notifyOn: 'Yes - I will complete a separate issue form now', required: true },
    { id: 'needWAH', type: 'single', label: 'Do you need to complete a Works Area Handover (WAH) form?', options: ['Yes - I will complete a WAH form now', 'No'], help: 'WAH needed when: leaving site >2 days with works remaining; a roof area/elevation is complete; or the project is complete in its entirety.', required: true },

    { id: 's_photos', type: 'section', label: 'Photos' },
    { id: 'photos', type: 'photos', label: 'Insert PHOTOS of works completed, site conditions, delay, quality, H&S issues.' },

    { id: 's_approval', type: 'section', label: 'Approval' },
    { id: 'signature', type: 'signature', label: 'I confirm the information I have provided is true and that I have completed all sections accurately and diligently', required: true },
  ],
}

// ── Contracts Manager Site Report ──────────────────────────────────────────
const contractsManagerReport = {
  id: 'contracts-manager-report',
  category: 'project',
  title: 'Contracts Managers Site Report',
  short: 'Manager-level weekly/visit report on variations, H&S, quality, progress.',
  fields: [
    { id: 's_general', type: 'section', label: 'General Information' },
    { id: 'reportDate', type: 'date', label: 'Report Date', required: true },
    { id: 'yourName', type: 'shorttext', label: 'Insert your name', required: true },

    { id: 's_var', type: 'section', label: 'Variations' },
    { id: 'varToPrice', type: 'longtext', label: 'Are there any variations required to be priced?' },
    { id: 'varToInstruct', type: 'longtext', label: 'Are there any variations priced that need instruction?' },
    { id: 'varImpact', type: 'longtext', label: 'Are there any Variations that if not instructed will start to impact progress?' },

    { id: 's_safety', type: 'section', label: 'We Only Accept Absolute Safety: Zero Accidents' },
    { id: 'hsReported', type: 'longtext', label: 'Have there been any H&S issues reported?' },

    { id: 's_quality', type: 'section', label: 'We Are Quality Obsessed: Zero Defects' },
    { id: 'qualityReported', type: 'longtext', label: 'Have there been any quality issues reported and how are / have these been resolved?' },
    { id: 'futureIngress', type: 'longtext', label: 'Is there anything that we anticipate could cause a future water ingress or quality issue and what has been discussed on site?' },
    { id: 'preStartDone', type: 'single', label: 'Have all Pre-Start Notifications been completed?', options: ['Yes', 'No, I will complete now'], notifyOn: 'No, I will complete now', required: true },
    { id: 'wahDone', type: 'single', label: 'Have all Works Area Handover Forms been completed?', options: ['Yes', 'No, I will complete now'], notifyOn: 'No, I will complete now', required: true },
    { id: 'wirfDone', type: 'single', label: 'Has there been any water ingress reported and if so has a Water Ingress Report Form been completed?', options: ['Yes - All WIRFs completed', 'No - WIRF to be completed now', 'No - N/A'], notifyOn: 'No - WIRF to be completed now', required: true },

    { id: 's_delay', type: 'section', label: 'Delay and Disruption' },
    { id: 'delayNow', type: 'longtext', label: 'Is there anything that has caused delay on site?' },
    { id: 'delayFuture', type: 'longtext', label: 'Is there anything that we anticipate will cause delay on site if not resolved?' },

    { id: 's_works', type: 'section', label: 'Works Completed' },
    { id: 'worksCompleted', type: 'longtext', label: 'What works have been completed on the project?' },
    { id: 'pctComplete', type: 'shorttext', label: 'What is the approximate percentage completion of the contract works?' },
    { id: 'preventing', type: 'longtext', label: 'Is there anything that is preventing us from completing our project works? e.g. roof areas not ready' },

    { id: 's_photos', type: 'section', label: 'Photos' },
    { id: 'photos', type: 'photos', label: 'MANDATORY - Insert photos to support all comments made to evidence works completed and issues raised.', mandatory: true },

    { id: 's_approval', type: 'section', label: 'Approval' },
    { id: 'signature', type: 'signature', label: 'I confirm the information I have provided is true and that I have completed all sections accurately and diligently', required: true },
  ],
}

// ── Water Ingress Report ───────────────────────────────────────────────────
const waterIngress = {
  id: 'water-ingress-report',
  category: 'project',
  title: 'Water Ingress Report',
  short: 'Record and assess any reported water ingress on a project.',
  fields: [
    { id: 's_general', type: 'section', label: 'General Information' },
    { id: 'surveyDate', type: 'date', label: 'Date on which the water ingress survey and assessment took place', required: true },
    { id: 'yourName', type: 'shorttext', label: 'Your name', required: true },
    { id: 'reportedBy', type: 'shorttext', label: 'Who reported the water ingress?', required: true },
    { id: 'reportedDate', type: 'date', label: 'What date was the water ingress reported?' },

    { id: 's_ingress', type: 'section', label: 'Water Ingress' },
    { id: 'issue', type: 'longtext', label: 'What is the water ingress issue that has been reported to Rock?', required: true },
    { id: 'result', type: 'longtext', label: 'What has happened as a result of the water ingress?' },
    { id: 'damagePhotos', type: 'photos', label: 'Insert photos of any damage caused by the water ingress' },
    { id: 'causeEstablished', type: 'single', label: 'Have we established the cause of the water ingress?', options: ['Yes', 'No', 'Unable to determine the cause of the water ingress'], required: true },
    { id: 'cause', type: 'longtext', label: 'What have we determined to be the cause of the water ingress?' },
    { id: 'causePhotos', type: 'photos', label: 'MANDATORY - Insert photos of the cause of the water ingress', mandatory: true },
    { id: 'responsible', type: 'single', label: 'Who is responsible for the water ingress?', options: ['Rock', 'The Main Contractor', 'Other Trade Contractor', 'Building End User / Building Maintenance Contractor', 'Inconclusive'], required: true },
    { id: 'discussed', type: 'single', label: 'Have you discussed your findings with a Rock Manager before leaving site?', options: ['Yes - Calling a RR Manager before leaving site is mandatory'], mandatory: true, required: true },

    { id: 's_solution', type: 'section', label: 'The Solution' },
    { id: 'haveSolution', type: 'single', label: 'Do we have a proposed solution to remedy and prevent any further water ingress?', options: ['Yes', 'No', 'TBC - further investigations / discussions needed'], required: true },
    { id: 'furtherAction', type: 'longtext', label: 'What further action is needed to remedy and prevent any further water ingress?' },

    { id: 's_approval', type: 'section', label: 'Approval' },
    { id: 'signature', type: 'signature', label: 'I confirm the information I have provided is true and that I have completed all sections accurately and diligently', required: true },
  ],
}

// ── Works Area Handover (WAH) ──────────────────────────────────────────────
const worksAreaHandover = {
  id: 'works-area-handover',
  category: 'project',
  title: 'Works Area Handover',
  short: 'Handover of a completed roof area / elevation or on leaving site.',
  fields: [
    { id: 's_general', type: 'section', label: 'General Information' },
    { id: 'leftDate', type: 'date', label: 'Date when we left site', required: true },
    { id: 'yourName', type: 'shorttext', label: 'Your name', required: true },
    { id: 'operatives', type: 'longtext', label: 'Operatives on site on the last day of the project' },
    { id: 'complete', type: 'single', label: 'Are the project works completed in their entirety?', options: ['Yes', 'No'], required: true },
    { id: 'areas', type: 'longtext', label: 'Which works area/s are being handed over?', required: true },
    { id: 'describeHandover', type: 'longtext', label: 'Describe in detail the works being handed over' },
    { id: 'stillToComplete', type: 'longtext', label: 'Describe in detail any contracted works that are still to complete.' },
    { id: 'reasonIncomplete', type: 'longtext', label: 'If there are still outstanding contracted works, what is the reason we are unable to complete?' },
    { id: 'supplyOnly', type: 'longtext', label: 'Describe any supply only materials we have left on site and who we have left them with.' },
    { id: 'photosInserted', type: 'single', label: 'Have you inserted photos of the works completed and detailed in this WAH?', options: ['Yes - I have inserted photos of works completed and photos of areas where we are unable to complete'], required: true },
    { id: 'photos', type: 'photos', label: 'MANDATORY - Insert photos showing completed project. Overall photos and specific detailing to demonstrate quality.', mandatory: true },

    { id: 's_quality', type: 'section', label: 'We Are Quality Obsessed: Zero Defects' },
    { id: 'defectFree', type: 'single', label: 'Have you checked the roof / cladding works are defect free?', options: ['Yes', 'No - I have reported to the Rock Roofing Contracts Manager identified quality issues'], notifyOn: 'No - I have reported to the Rock Roofing Contracts Manager identified quality issues', required: true },

    { id: 's_house', type: 'section', label: 'We Are Proactive: Housekeeping' },
    { id: 'clearWaste', type: 'single', label: 'Is the roof / cladding works area clear of waste and debris?', options: ['Yes', 'No', 'N/A - leaving site'], required: true },
    { id: 'materialsSecured', type: 'single', label: 'Are materials adequately weighed down / secured?', options: ['Yes', 'No', 'N/A - leaving site'], required: true },
    { id: 'materialsLeft', type: 'longtext', label: 'Describe in detail any materials we have left on the project.' },
    { id: 'materialsStored', type: 'longtext', label: 'Where have materials been safely stored on the project?' },
    { id: 'materialsPhoto', type: 'photos', label: 'Insert a photo of any materials left on the project' },
    { id: 'agreedBy', type: 'shorttext', label: "Who from the customer's site team has agreed the location of where materials have been left?" },
    { id: 'collectMaterials', type: 'single', label: 'Do Rock management need to arrange for materials to be collected from site?', options: ['Yes', 'No - there are no more materials left on this project', 'Current project materials are required for other roof areas'] },

    { id: 's_plant', type: 'section', label: 'Plant and Equipment' },
    { id: 'offHire', type: 'single', label: 'Is there any plant or equipment to be off-hired?', options: ['Yes', 'No'] },
    { id: 'offHireNotified', type: 'shorttext', label: 'Which Rock Roofing manager have you notified of any plant or equipment that needs off-hiring?' },
    { id: 'offHireDescribe', type: 'longtext', label: 'Describe the plant and equipment that needs off-hiring' },

    { id: 's_approval', type: 'section', label: 'Approval' },
    { id: 'signature', type: 'signature', label: 'I confirm the information I have provided is true and that I have completed all sections accurately and diligently', required: true },
  ],
}

// ── Pre-Start Notification ─────────────────────────────────────────────────
const preStart = {
  id: 'pre-start-notification',
  category: 'project',
  title: 'Pre-Start Notification',
  short: 'Confirm start/return to site, deliveries, access, H&S before mobilising.',
  fields: [
    { id: 's_works', type: 'section', label: 'The Works' },
    { id: 'startDate', type: 'date', label: 'Confirmed start / return date', required: true },
    { id: 'requestedBy', type: 'shorttext', label: 'Who requested us to return to site?', required: true },
    { id: 'requestedEmail', type: 'shorttext', label: 'What is the email address of the person who requested us to return to site? (who this notification is sent to)', required: true },
    { id: 'commMethod', type: 'single', label: 'How was the start on site / return to site date communicated?', options: ['Email', 'Phone Call', 'Instant Messaging'] },
    { id: 'confirmedOn', type: 'date', label: 'On what date were we given a confirmed start on site / return to site date?' },
    { id: 'visitNumber', type: 'shorttext', label: 'Visit Number' },
    { id: 'describeWorks', type: 'longtext', label: 'Describe the works that have been agreed to be carried out in this visit.', required: true },

    { id: 's_deliveries', type: 'section', label: 'Deliveries, Offloading, and Lifting' },
    { id: 'deliveries', type: 'longtext', label: 'What materials are being delivered, on what date and on what type of vehicle?' },
    { id: 'offloadMethod', type: 'multi', label: 'How have materials been agreed to be safely offloaded from delivery vehicles?', options: ['Telehandler', 'Vehicle with Moffit', 'Crane', 'Pallet Truck', 'Vehicle with tail lift', 'Ancillaries or fixings only, mechanical offloading N/A'] },
    { id: 'offloadResp', type: 'single', label: 'Who is responsible for offloading?', options: ['The Main Contractor / Customer', 'Rock Roofing Ltd'] },
    { id: 'liftType', type: 'multi', label: 'What type of mechanical lifting has been agreed for vertical distribution?', options: ['Crane', 'Telehandler', 'Goods Hoist', 'MEWP'] },
    { id: 'liftResp', type: 'single', label: 'Who is responsible for vertical distribution / lifting?', options: ['The Main Contractor / Customer', 'Rock Roofing Ltd'] },
    { id: 'laydown', type: 'single', label: 'Has a laydown area been agreed or are materials being lifted directly onto the roof?', options: ['Materials stored at ground level and lifted to roof / walls as required', 'Materials being lifted directly onto the roof'] },

    { id: 's_access', type: 'section', label: 'Access' },
    { id: 'access', type: 'multi', label: 'What is the agreed access to the roof / walls? (MEWPs are NOT a permitted means of roof access)', options: ['Haki Staircase', 'Scaffold', 'Ladder', 'MEWP'] },
    { id: 'fallProtection', type: 'multi', label: 'What means of collective fall protection are we using? (Rock do not work off harnesses)', options: ['Perimeter Scaffold', 'Perimeter Handrail', 'Parapet wall with a height greater than 950mm'] },
    { id: 'accessResp', type: 'single', label: 'Who is responsible for providing safe access equipment and collective fall protection measures?', options: ['The Main Contractor / The Customer', 'Rock Roofing Ltd'] },

    { id: 's_others', type: 'section', label: 'Works By Others / Design' },
    { id: 'worksByOthers', type: 'longtext', label: 'What works are required to be completed by others prior to our visit to site?' },
    { id: 'designItems', type: 'longtext', label: 'Describe any items relating to interface, design or approval that need resolving prior to arrival at site.' },

    { id: 's_hs', type: 'section', label: 'H&S' },
    { id: 'ramsAgreed', type: 'single', label: 'Have the RAMS been agreed with the Main Contractor / Customer?', options: ['Yes', 'No - RAMS to be approved at least 7 days prior to starting. If no response, RAMS deemed accepted.'], required: true },
    { id: 'inductions', type: 'shorttext', label: 'When have site inductions been agreed to be carried out?' },
    { id: 'otherComments', type: 'longtext', label: 'Any other comments?' },

    { id: 's_approval', type: 'section', label: 'Approval' },
    { id: 'signature', type: 'signature', label: 'I confirm the information I have provided is true and complete', required: true },
  ],
}

// Seed set. The two remaining forms you sent — Daily Quality Inspection,
// Start On Site Checklist, Internal H&S Audit — follow the exact same shape
// and can be added here or built in the in-app form builder.
export const SEED_FORMS = [
  dailySiteDiary,
  contractsManagerReport,
  waterIngress,
  worksAreaHandover,
  preStart,
]

export default SEED_FORMS
