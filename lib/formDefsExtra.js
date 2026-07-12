// Additional seeded forms (converted from the Fonn exports to the Site App's
// internal form model). Field-type mapping used:
//   datetime -> date, string -> shorttext, textarea/large-textarea -> longtext,
//   radio-vertical -> single, checkbox-vertical -> multi, multi_image_file -> photos,
//   cloneable_signature/signature -> signature, members -> members, label -> note,
//   divider -> (omitted).
//
// `group` places a project-category form into a sub-section on the Site App
// "Complete a Form" list. `accessLevel: 'contracts-manager'` restricts a form to CMs.
// `notifyOn` on a single-choice field raises a Flag when that option is chosen.

// ── ACCIDENT BOOK: H&S Incident Record ──────────────────────────────────────
const accidentBook = {
  id: 'accident-book-hs-incident-record',
  category: 'project',
  group: 'hs-incidence',
  title: 'ACCIDENT BOOK: H&S Incident Record',
  short: 'Completed every time an injury occurs on site — mandatory for ALL injuries of any type or severity.',
  fields: [
    { id: 's_gen', type: 'section', label: 'General Information' },
    { id: 'f_reporter', type: 'members', label: 'The person conducting this report / investigation', help: 'Select the name of the person conducting this report / investigation' },
    { id: 'f_cm', type: 'members', label: 'Insert the name of the Rock Roofing Contracts Manager responsible for this project', required: true },
    { id: 'f_injured', type: 'members', label: 'The injured person', help: "Select the person working on behalf of Rock Roofing" },
    { id: 'f_witnesses', type: 'longtext', label: 'Insert the names, telephone numbers and addresses of all witnesses to the incident.' },

    { id: 's_incident', type: 'section', label: 'The Incident' },
    { id: 'f_date', type: 'date', label: 'What date did the incident occur?', required: true },
    { id: 'f_time', type: 'shorttext', label: 'What time did the incident occur?', required: true },
    { id: 'f_damage', type: 'longtext', label: 'What damage occurred and what injuries were sustained?', required: true },
    { id: 'f_where', type: 'longtext', label: 'Where did the accident happen? State the room or specific location.', required: true },
    { id: 'f_how', type: 'longtext', label: 'How did the accident / incident happen?', required: true },
    { id: 'f_cause', type: 'longtext', label: 'Do you know what the cause of the incident was?' },
    { id: 'f_tasks', type: 'longtext', label: 'What activities / tasks were being carried out at the time of the accident?', required: true },

    { id: 's_photos', type: 'section', label: 'Photos' },
    { id: 'f_photos', type: 'photos', label: '*MANDATORY - Add photos of the location and cause of the H&S incident.', help: 'Ensure that all photos clearly show the scene to evidence what has occurred and lessons learnt.', required: true },

    { id: 's_lessons', type: 'section', label: 'Lessons Learnt' },
    { id: 'f_lessons', type: 'single', label: 'It is MANDATORY that a "H&S Accident and Incident Report and Lessons Learnt" is now completed by a Rock Contracts Manager. Have you assigned a task to the designated Rock Contracts Manager to complete it? You MUST do this now if not done so already.', options: ['Yes'] },

    { id: 's_submit', type: 'section', label: 'Submit and Notify' },
    { id: 'f_confirm', type: 'note', label: 'I can confirm that the information I have provided is true and that I have completed all sections accurately and diligently.' },
    { id: 'f_sign', type: 'signature', label: 'Signed' },
    { id: 'f_notify', type: 'note', label: 'Please "SUBMIT & NOTIFY" the Rock Roofing Contracts Manager who is responsible for this project. It is mandatory that the Contracts Manager now completes the "H&S Accident and Incident Report and Lessons Learnt".' },
  ],
}

// ── NEAR MISS REPORT FORM ───────────────────────────────────────────────────
const nearMiss = {
  id: 'near-miss-report',
  category: 'project',
  group: 'hs-incidence',
  title: 'Near Miss Report Form',
  short: 'Record details of workplace near misses. Reporting is mandatory and encouraged — you will be praised, not penalised.',
  fields: [
    { id: 's_gen', type: 'section', label: 'General Information' },
    { id: 'f_date', type: 'date', label: 'Date on which the near miss occurred', required: true },
    { id: 'f_loc', type: 'shorttext', label: 'Location on site where this near miss occurred', required: true },
    { id: 'f_name', type: 'members', label: 'Your name' },

    { id: 's_persons', type: 'section', label: 'Rock Roofing Operatives / Persons Involved' },
    { id: 'f_ops', type: 'members', label: 'Select the names of all persons working on behalf of Rock Roofing who were involved in the near miss' },
    { id: 'f_other_rock', type: 'shorttext', label: 'Any other persons working on behalf of Rock Roofing who were involved?' },
    { id: 'f_third', type: 'shorttext', label: 'Any other third parties such as other trades or main contractor involved?', required: true },

    { id: 's_cause', type: 'section', label: 'Cause' },
    { id: 'f_work', type: 'longtext', label: 'Give details of any work or process being performed at the time the near miss occurred', required: true },

    { id: 's_wit', type: 'section', label: 'Witnesses' },
    { id: 'f_wit', type: 'shorttext', label: 'Provide the names, addresses and occupations of any witnesses to the near miss' },

    { id: 's_actions', type: 'section', label: 'Actions' },
    { id: 'f_corrective', type: 'shorttext', label: 'What corrective actions have we taken to avoid reoccurrence?', required: true },
    { id: 'f_process', type: 'longtext', label: 'What specific role or business processes and / or documents can we amend to ensure that this near miss does not reoccur?', required: true },
    { id: 'f_task', type: 'single', label: 'Have you set up a Task or Issue and assigned it to the relevant person to address any required changes / corrective action?', options: ['Yes', 'No - Processes have been amended and / or corrective action has already taken place'] },

    { id: 's_director', type: 'section', label: 'Director Meeting' },
    { id: 'f_director', type: 'single', label: 'Have you notified the Rock Roofing Operations Manager to arrange a review meeting with Directors to review recommendations and proposed changes?', required: true, options: ['Yes - Mandatory to arrange this meeting'] },

    { id: 's_photos', type: 'section', label: 'Photos' },
    { id: 'f_photos', type: 'photos', label: '*MANDATORY - Insert photos to evidence the incident that has occurred.', required: true },

    { id: 's_approval', type: 'section', label: 'Approval' },
    { id: 'f_confirm', type: 'note', label: 'I can confirm that the information I have provided is true and that I have completed all sections accurately and diligently.' },
    { id: 'f_sign', type: 'signature', label: 'Signed' },
    { id: 'f_notify', type: 'note', label: 'Please "SUBMIT & NOTIFY" the Rock Roofing Contracts Manager who is responsible for this project.' },
  ],
}

// ── H&S ACCIDENT AND INCIDENT REPORT AND LESSONS LEARNT ──────────────────────
const hsAccidentReport = {
  id: 'hs-accident-incident-report-lessons-learnt',
  category: 'project',
  group: 'hs-incidence',
  accessLevel: 'contracts-manager',
  title: 'H&S Accident and Incident Report and Lessons Learnt',
  short: 'Completed by a Contracts Manager after every Accident / Incident form.',
  fields: [
    { id: 's_gen', type: 'section', label: 'General Information' },
    { id: 'f_reporter', type: 'members', label: 'The person conducting this report / investigation' },
    { id: 'f_date', type: 'date', label: 'Date on which this investigation report is being completed', required: true },

    { id: 's_injury', type: 'section', label: 'Injury Details and Treatment' },
    { id: 'f_nature', type: 'multi', label: 'What was the nature of the accident?', help: 'Multiple options can be selected.', options: ['Struck by machine or vehicle', 'Electrocution', 'Fall from height', 'Hit by object falling from height', 'Hand tool', 'Power tool', 'Trip, slip or fall', 'Burns / scald', 'Substance', 'Respiratory', 'Other - note in the comments section below'] },
    { id: 'f_nature_other', type: 'longtext', label: 'If "Other", leave comments here.' },
    { id: 'f_body', type: 'multi', label: 'What part of the body was affected?', help: 'Multiple options can be selected.', options: ['Head', 'Arm', 'Foot', 'Eye', 'Hand', 'Internal', 'Trunk', 'Finger', 'Back', 'Leg', 'Hearing', 'Multiple'] },
    { id: 'f_action', type: 'multi', label: 'What action has the injury resulted in?', help: 'Multiple options can be selected.', options: ['First aid on site', 'Sent home', 'Sent to hospital', 'Sent to Health Centre', 'Referred to GP', 'Work with restrictions', 'Referred to Occupational Health', 'Other - note in the comments section below'] },
    { id: 'f_action_other', type: 'longtext', label: 'If "Other", leave comments here.' },
    { id: 'f_outcome', type: 'multi', label: 'What was the outcome of the injury?', options: ['Fatal', 'Major Injury', 'Minor Injury', 'Lost Time', 'Disabling Injury', 'Damage only', 'Occupational illness'] },

    { id: 's_account', type: 'section', label: 'Account of the Incident' },
    { id: 'f_witnesses', type: 'longtext', label: 'Describe in detail and clearly all conversations with witnesses including their full names.', required: true },
    { id: 'f_interpretation', type: 'longtext', label: 'Describe in detail and clearly your interpretation of how the accident occurred.', required: true },
    { id: 'f_recovery', type: 'longtext', label: 'Describe in detail and clearly any damage and / or the steps that the injured person has taken to aid recovery.', required: true },

    { id: 's_controls', type: 'section', label: 'Controls' },
    { id: 'f_ssow', type: 'single', label: 'Was there a safe system of work for the job / task that was being performed?', required: true, options: ['Yes', 'No'] },
    { id: 'f_signed_ssow', type: 'single', label: 'Had the injured person signed up to the prescribed safe system of work?', options: ['Yes', 'No'] },
    { id: 'f_trained', type: 'single', label: 'Was the injured person trained in the system of work?', options: ['Yes', 'No'] },
    { id: 'f_ppe', type: 'single', label: 'Was the person wearing the prescribed PPE?', options: ['Yes', 'No'] },
    { id: 'f_followed', type: 'single', label: 'Was the safe system of work followed?', required: true, options: ['Yes', 'No'] },
    { id: 'f_authorised', type: 'single', label: 'Was the person authorised to do the work?', options: ['Yes', 'No'] },
    { id: 'f_supervised', type: 'single', label: 'Was the job/task appropriately supervised?', options: ['Yes', 'No'] },

    { id: 's_unsafe', type: 'section', label: 'Unsafe Acts and Unsafe Conditions' },
    { id: 'f_unsafe', type: 'multi', label: 'What unsafe acts or conditions were there?', options: ['Unsafe use of tools/equipment', 'Failure to wear P.P.E.', 'Unsafe position/posture', 'Safe System of Work not followed', 'Operating without authority', 'Operating at unsafe speed', 'Using unsafe tools/equipment', 'Rendering guards/safety devices inoperable', 'Horseplay', 'Tampering', 'Defective tools/equipment/substances', 'Inadequate guards/safety devices', 'Poor housekeeping/stacking', 'Unsafe design/construction', 'P.P.E. not provided', 'Inadequate lighting', 'Unsafe access/egress', 'Poor environment/temperature extremes', 'Poor job/task design', 'Distractions'] },

    { id: 's_contrib', type: 'section', label: 'Contributory Factors' },
    { id: 'f_contrib', type: 'multi', label: 'What were the contributory factors?', options: ['Poor personnel selection', 'Inadequate training/information', 'Inadequate tools and equipment', 'Inadequate purchasing standards', 'Inadequate job/task design', 'Inadequate safe system of work', 'Improper modifications/substitution', 'Mechanical/electrical failure', 'Inadequate supervision/leadership', 'Inadequate maintenance/repairs', 'Inadequate safety inspections', 'Poor company culture', 'Poor housekeeping/congestion', 'Excessive noise/vibration', 'Inadequate emergency measures', 'Inadequate spare parts', 'Wear and tear', 'Poor weather conditions', 'Substandard materials/substances', 'Production pressures/costs'] },

    { id: 's_personal', type: 'section', label: 'Personal Factors' },
    { id: 'f_personal', type: 'multi', label: 'What were the personal factors?', options: ['Lack of knowledge/skill', 'Poor motivation/attitude', 'Avoiding discomfort', 'Wilful deviation from instructions/SSOW', 'Fatigued/incapacitated', 'Peer group pressure/approval', 'Illness/stress/physical problem', 'Attempt to gain or save time', 'Alcohol or medication use', 'Failure to appreciate risks', 'Failure to plan', 'Carelessness/boredom'] },

    { id: 's_recommend', type: 'section', label: 'Recommendations' },
    { id: 'f_recommend', type: 'multi', label: 'What recommendations do you have to prevent this type of injury occurring again in the future?', options: ['Review personnel selection', 'Review job/task training', 'Conduct risk assessment', 'Revise/develop SSOW', 'Implement permit to work', 'Improve job/task design', 'Retrain/reinstruct', 'Improve communication', 'Post warnings/signs', 'Install guards/safety devices', 'Implement worker/job observation', 'Improve maintenance/repairs', 'Revise safety inspections/monitoring', 'Review materials/substances', 'Retrain others', 'Improve tools and equipment', 'Improve selection of contractors', 'Improve worker attitudes', 'Review issue of PPE and wear rate', 'Improve housekeeping/work environment'] },

    { id: 's_summary', type: 'section', label: 'Summary of Recommendations' },
    { id: 'f_summary', type: 'longtext', label: 'Describe in detail and clearly what recommendations you have to prevent a recurrence of the injury.', required: true },

    { id: 's_riddor', type: 'section', label: 'RIDDOR' },
    { id: 'f_riddor_7', type: 'note', label: 'Over-seven-day incapacitation of a worker: Accidents must be reported where they result in an employee or self-employed person being away from work, or unable to perform their normal work duties, for more than seven consecutive days as the result of their injury. This seven-day period does not include the day of the accident, but does include weekends and rest days. The report must be made within 15 days of the accident.' },
    { id: 'f_riddor_3', type: 'note', label: 'Over-three-day incapacitation: Accidents must be recorded, but not reported, where they result in a worker being incapacitated for more than three consecutive days. An accident book kept under the Social Security (Claims and Payments) Regulations 1979 is sufficient.' },
    { id: 'f_riddor_notifiable', type: 'single', label: 'Is this incident notifiable to the HSE under RIDDOR?', options: ['Yes', 'No'] },
    { id: 'f_riddor_f2508', type: 'single', label: 'Has form F2508 been sent as required under RIDDOR?', options: ['Yes', 'No'] },
    { id: 'f_riddor_date', type: 'date', label: 'If a F2508 form has not been sent, insert the date by which you intend to submit the form. MANDATORY: you must also add a Task and assign responsibility for this form to be submitted to the HSE.' },

    { id: 's_manager', type: 'section', label: 'Manager Comments and Approval' },
    { id: 'f_director_task', type: 'single', label: 'MANDATORY - Have you set a task for a Rock Roofing Director to review this investigation report?', required: true, options: ['Yes'] },
    { id: 'f_consultant', type: 'single', label: 'MANDATORY - You must now submit this report to our external H&S consultant for review and comment. Please confirm your commitment to do this.', options: ['Yes'] },

    { id: 's_dirmeet', type: 'section', label: 'Director Meeting' },
    { id: 'f_dirmeet', type: 'single', label: 'Have you notified the Rock Roofing Operations Manager to arrange a review meeting with Directors to review recommendations and proposed changes?', required: true, options: ['Yes - Mandatory, arrange now'] },

    { id: 's_photos', type: 'section', label: 'Photos' },
    { id: 'f_photos', type: 'photos', label: '*MANDATORY - Add photos to evidence this incident.', required: true },

    { id: 's_sign', type: 'section', label: 'Signature' },
    { id: 'f_confirm', type: 'note', label: 'I can confirm that the information I have provided is true and that I have completed all sections accurately and diligently.' },
    { id: 'f_sign', type: 'signature', label: 'Signed' },
    { id: 'f_notify', type: 'note', label: 'Please "SUBMIT & NOTIFY" the Rock Roofing Director.' },
  ],
}

// ── DAYWORK SHEET & ONSITE INSTRUCTIONS ─────────────────────────────────────
const dayworkSheet = {
  id: 'daywork-sheet-onsite-instructions',
  category: 'project',
  title: 'Daywork Sheet & Onsite Instructions',
  short: 'Record labour, materials and plant for instructed daywork so it can be valued and charged as a Variation.',
  fields: [
    { id: 's_gen', type: 'section', label: 'General Information' },
    { id: 'f_date', type: 'date', label: 'Date on which these dayworks started / apply', required: true },
    { id: 'f_name', type: 'members', label: 'Your name' },
    { id: 'f_maincontractor', type: 'shorttext', label: 'Main Contractor name', required: true },
    { id: 'f_requestedby', type: 'shorttext', label: 'Who from the customer requested these dayworks? Include the name, role, and company they work for.', required: true },

    { id: 's_works', type: 'section', label: 'Works Carried Out' },
    { id: 'f_works', type: 'longtext', label: 'Describe in detail the works requested to be carried out.', required: true },

    { id: 's_loc', type: 'section', label: 'Location' },
    { id: 'f_loc', type: 'shorttext', label: 'Detail the location on the roof / roof area where the works are required.', required: true },

    { id: 's_mats', type: 'section', label: 'Materials' },
    { id: 'f_mats', type: 'shorttext', label: 'Detail the materials used including quantities and unit of measurement, or enter "TBC".' },

    { id: 's_labour', type: 'section', label: 'Labour' },
    { id: 'f_ops', type: 'single', label: 'Insert the number of operatives required to carry out the dayworks.', options: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'] },
    { id: 'f_hours', type: 'shorttext', label: 'Insert the TOTAL man hours utilised including ALL operatives (e.g. 2 operatives for 2 hours = 4 hours), or enter "TBC".' },

    { id: 's_plant', type: 'section', label: 'Plant' },
    { id: 'f_plant', type: 'shorttext', label: 'Describe in detail the plant being used.' },
    { id: 'f_plant_hours', type: 'shorttext', label: 'Insert the total number of plant hours used, or enter "TBC".' },

    { id: 's_comments', type: 'section', label: 'Comments' },
    { id: 'f_comments', type: 'longtext', label: 'Insert any comments including discussions had on site and any other contributing factors.' },

    { id: 's_photos', type: 'section', label: 'Photos' },
    { id: 'f_photos', type: 'photos', label: '*MANDATORY - Insert photos to this daywork sheet to better evidence any occurrences and its need.' },

    { id: 's_rocksign', type: 'section', label: 'Rock Site Representative Signature' },
    { id: 'f_rocksign', type: 'signature', label: 'Rock Roofing Site Representative Signature' },

    { id: 's_mcsign', type: 'section', label: 'Main Contractor Site Representative Signature' },
    { id: 'f_mc_accept', type: 'note', label: 'I accept these dayworks as a Variation under the contract between Rock Roofing Ltd (the Sub-Contractor) and the Main Contractor under the above named project.' },
    { id: 'f_mcsign', type: 'signature', label: 'Main Contractor Site Representative Signature' },

    { id: 's_submit', type: 'section', label: 'Submit and Notify' },
    { id: 'f_notify', type: 'note', label: 'Please now "SUBMIT & NOTIFY" the designated Rock Roofing Quantity Surveyor on this project.' },
  ],
}

// ── USING A HARNESS ─────────────────────────────────────────────────────────
const harness = {
  id: 'using-a-harness',
  category: 'project',
  title: 'Using a Harness',
  short: 'Complete prior to using a harness. Any "No" answer means you are not permitted to use the harness.',
  fields: [
    { id: 's_gen', type: 'section', label: 'General Information' },
    { id: 'f_name', type: 'members', label: 'Your name', required: true },
    { id: 'f_date', type: 'date', label: 'Date', required: true },

    { id: 's_steps', type: 'section', label: 'Mandatory Steps before using a Harness' },
    { id: 'f_rescue', type: 'single', label: 'Is there a rescue plan in place that ensures safe recovery to all elevations?', required: true, options: ['Yes', 'No - Do not proceed, you are not permitted to use the harness'] },
    { id: 'f_rams_updated', type: 'single', label: 'Have the RAMS been updated to include harness working?', required: true, options: ['Yes', 'No - Do not proceed, you are not permitted to use the harness'] },
    { id: 'f_rams_signed', type: 'single', label: 'Have you and all operatives using a harness been briefed, understand, and signed the RAMS which include harness working?', required: true, options: ['Yes', 'No - Do not proceed, you are not permitted to use the harness'] },
    { id: 'f_rams_approved', type: 'single', label: 'Have the RAMS been signed by the Rock Roofing Contracts Manager, the Main Contractor, a Rock Roofing Director, and the Rock Roofing external H&S consultant?', required: true, options: ['Yes', 'No - Do not proceed, you are not permitted to use the harness'] },
    { id: 'f_cert', type: 'single', label: 'Do all harnesses being used have testing and certification carried out within the last 6 months?', required: true, options: ['Yes', 'No - Do not proceed, you are not permitted to use the harness'] },
    { id: 'f_cert_photos', type: 'photos', label: 'Insert photos of your harness certification testing. Your harness must have been certified within the last 6 months.', required: true },
    { id: 'f_asset', type: 'single', label: 'Are all harnesses being used on the Rock Roofing Asset Register? Confirm with the Rock Roofing Operations Manager.', required: true, options: ['Yes', 'No - Do not proceed, you are not permitted to use the harness'] },
    { id: 'f_training', type: 'single', label: 'Do you and all operatives using harnesses have the correct and specific practical training to use the harness? Confirm with the Rock Roofing Operations Manager.', required: true, options: ['Yes', 'No - Do not proceed, you are not permitted to use the harness'] },
    { id: 'f_restraint', type: 'single', label: 'Can we work to fall restraint and not to fall arrest?', required: true, options: ['Yes', 'No - Do not proceed, you are not permitted to use the harness'] },

    { id: 's_approval', type: 'section', label: 'Approval' },
    { id: 'f_confirm', type: 'note', label: 'I confirm that the information I have provided is true and I have completed all sections accurately and diligently.' },
    { id: 'f_sign', type: 'signature', label: 'Signature' },
  ],
}

export const EXTRA_SEED_FORMS = [
  accidentBook,
  nearMiss,
  hsAccidentReport,
  dayworkSheet,
  harness,
]

export default EXTRA_SEED_FORMS
