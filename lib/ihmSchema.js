// ───────────────────────────────────────────────────────────────────────────
// Internal Handover Minutes (IHM) — schema
//
// Mirrors Rock Roofing's Internal Handover Minutes Word template. Completing
// this in the portal creates an Operations project (keyed by RR Project Number).
// This is the operational master record; financials still come from Xero.
//
// Field types: text, long, date, select, yesno, contacts (repeatable rows),
//   rooftypes (repeatable spec blocks), risklog (repeatable rows).
// ───────────────────────────────────────────────────────────────────────────

export const IHM_SECTIONS = [
  {
    id: 'meeting',
    title: 'Meeting & Attendees',
    fields: [
      { id: 'estimator', label: 'Estimator', type: 'text' },
      { id: 'contractsManager', label: 'Contracts Manager', type: 'text' },
      { id: 'operationsManager', label: 'Operations Manager', type: 'text' },
      { id: 'designManager', label: 'Design Manager', type: 'text' },
      { id: 'quantitySurveyor', label: 'Quantity Surveyor', type: 'text' },
      { id: 'siteSupervisor', label: 'Site Supervisor', type: 'text' },
      { id: 'meetingDate', label: 'Date of Meeting', type: 'date' },
      { id: 'videoLink', label: 'Link to recorded internal meeting', type: 'text' },
      { id: 'meetingOther', label: 'Other', type: 'long' },
    ],
  },
  {
    id: 'project',
    title: 'Project Details',
    fields: [
      { id: 'projectName', label: 'Project Name', type: 'text', required: true },
      { id: 'projectNo', label: 'RR Project Number', type: 'text', required: true, help: 'Auto-suggested (next after the highest so far) — edit if needed. This is the project’s unique key.' },
      { id: 'customerOrderRef', label: 'Customer Order Ref', type: 'text' },
      { id: 'projectAddress', label: 'Project Address', type: 'long' },
    ],
  },
  {
    id: 'customer',
    title: 'Customer Details',
    fields: [
      { id: 'customerCompany', label: 'Company Name', type: 'text' },
      { id: 'customerAddress', label: 'Company Address', type: 'long' },
    ],
  },
  {
    id: 'siteContacts',
    title: 'Site Contacts',
    fields: [
      { id: 'siteContacts', label: 'Site contacts', type: 'contacts' },
    ],
  },
  {
    id: 'employer',
    title: 'Employer Details',
    fields: [
      { id: 'employerCompany', label: 'Company Name', type: 'text' },
      { id: 'employerAddress', label: 'Company Address', type: 'long' },
    ],
  },
  {
    id: 'manufacturer',
    title: 'Manufacturer Contact Details',
    fields: [
      { id: 'manufacturerContacts', label: 'Manufacturer contacts', type: 'contacts' },
    ],
  },
  {
    id: 'guarantee',
    title: 'Manufacturer Guarantee',
    fields: [
      { id: 'guaranteePeriod', label: 'Guarantee Period', type: 'long' },
      { id: 'warrantyConfirmed', label: 'Has the warranty period been confirmed?', type: 'yesno' },
      { id: 'specialProvisions', label: 'Any special provisions', type: 'long' },
      { id: 'signOffProcess', label: 'Sign off process', type: 'long' },
    ],
  },
  {
    id: 'scope',
    title: 'Scope of the Works',
    fields: [
      { id: 'quotationRevision', label: 'Quotation Revision', type: 'text' },
      { id: 'scopeOfWorks', label: 'Scope of works', type: 'long' },
    ],
  },
  {
    id: 'buildup',
    title: 'Roof Build-Up Specifications',
    fields: [
      { id: 'roofTypes', label: 'Roof types', type: 'rooftypes' },
      { id: 'procureFixings', label: 'Are we happy to procure the priced fixings: induction or side lap fixed?', type: 'long' },
      { id: 'insulationCorrect', label: 'Are we certain the insulation thickness is correct? Plasterboard ceiling if assumed/included?', type: 'long' },
      { id: 'aluminiumCappings', label: 'Aluminium Cappings', type: 'text' },
      { id: 'rainwaterGoods', label: 'Rainwater Goods', type: 'long' },
      { id: 'rooflights', label: 'Rooflights', type: 'text' },
      { id: 'accessHatches', label: 'Access Hatches', type: 'text' },
      { id: 'mansafe', label: 'Mansafe System', type: 'text' },
      { id: 'davit', label: 'Davit Abseil System', type: 'text' },
      { id: 'greenRoof', label: 'Green Roof (system type)', type: 'text' },
      { id: 'buildupOther', label: 'Anything else?', type: 'long' },
    ],
  },
  {
    id: 'design',
    title: 'Design Handover Checklist',
    fields: [
      { id: 'methodOfAttachment', label: 'CM confirmed method of attachment (side lap / induction / fully bonded)?', type: 'long' },
      { id: 'upstandInsulation', label: 'Is there insulation to the upstands?', type: 'yesno' },
      { id: 'upstandThickness', label: 'What thickness is the insulation to the upstands?', type: 'text' },
      { id: 'taperedDrawing', label: 'Has a tapered drawing been completed and what is the reference?', type: 'long' },
      { id: 'techSubmittalDrafted', label: 'Has a Technical Submittal been drafted?', type: 'long' },
      { id: 'techSubmittalChanges', label: 'Does the Technical Submittal require any changes?', type: 'long' },
      { id: 'supplierFileUpToDate', label: 'Is the Supplier file up to date and organised with the latest quotes?', type: 'long' },
      { id: 'postContractAware', label: 'Any drawings/documents/info the post contract team should be aware of?', type: 'long' },
      { id: 'drawingsInPossession', label: 'Are we in possession of the drawings in the Contract? Requested in PDF & DWG?', type: 'long' },
    ],
  },
  {
    id: 'commercial',
    title: 'Commercial',
    fields: [
      { id: 'contractValue', label: 'Contract Value', type: 'text' },
      { id: 'customerCreditScore', label: 'Customer Credit Score', type: 'text' },
      { id: 'customerCreditLimit', label: 'Customer Credit Limit', type: 'text' },
      { id: 'creditInsuredLimit', label: 'Credit Insured Limit', type: 'text' },
      { id: 'employerCreditScore', label: 'Employer Credit Score', type: 'text' },
      { id: 'employerCreditLimit', label: 'Employer Credit Limit', type: 'text' },
      { id: 'retention', label: 'Retention', type: 'text' },
      { id: 'discount', label: 'Discount', type: 'text' },
      { id: 'discountTimely', label: 'Has discount been applied for timely payment?', type: 'yesno' },
      { id: 'vat', label: 'VAT', type: 'text' },
      { id: 'measurableLumpSum', label: 'Re-Measurable / Lump Sum', type: 'text' },
      { id: 'paymentTerms', label: 'Payment Terms', type: 'long' },
      { id: 'applicationDate', label: 'Application Date', type: 'text' },
      { id: 'valuationDate', label: 'Valuation Date', type: 'text' },
      { id: 'longLeadItems', label: 'Any long lead-in items? Insert lead-in period for procurement.', type: 'long' },
    ],
  },
  {
    id: 'programme',
    title: 'Contracted Dates & Programme',
    fields: [
      { id: 'contractedPeriods', label: 'Contracted Programme Periods', type: 'text' },
      { id: 'phasing', label: 'How are the works set to be phased?', type: 'long' },
    ],
  },
  {
    id: 'variations',
    title: 'Variations',
    fields: [
      { id: 'unidentifiedScope', label: 'Any unidentified scope the Customer is still not aware of?', type: 'long' },
      { id: 'undecidedScope', label: 'Any undecided scope / rate only / below-the-line items to be instructed?', type: 'long' },
      { id: 'anticipatedVariations', label: 'Do we anticipate any other variations?', type: 'long' },
      { id: 'excludedVariations', label: 'Anything excluded that might become a variation to discuss?', type: 'long' },
      { id: 'variationsToPrice', label: 'Any variations that still need pricing?', type: 'long' },
    ],
  },
  {
    id: 'operations',
    title: 'Operations',
    fields: [
      { id: 'startDatesImportance', label: 'Has the MC site team been told about reliable start on site dates?', type: 'long' },
      { id: 'coordinationIssues', label: 'Do we anticipate any co-ordination issues?', type: 'long' },
      { id: 'hsRequirements', label: 'Are there any specific H&S requirements?', type: 'long' },
      { id: 'fallProtection', label: 'Are we prioritising collective fall protection measures?', type: 'long' },
      { id: 'siteRequirements', label: 'Are there any specific site requirements?', type: 'long' },
      { id: 'openingHours', label: 'What are the site opening hours?', type: 'text' },
      { id: 'deliveryTimes', label: 'Any restricted delivery times we must work around?', type: 'long' },
      { id: 'deliveryRequirements', label: 'Any specific delivery requirements? (rigids, moffit offload etc.)', type: 'long' },
      { id: 'articsPermitted', label: 'Are Artics permitted on site?', type: 'text' },
      { id: 'offloading', label: 'How are materials being safely offloaded?', type: 'long' },
      { id: 'laydownArea', label: 'Is there a specific lay down area?', type: 'text' },
      { id: 'attendances', label: 'Are we down to provide any attendances?', type: 'long' },
      { id: 'mechanicalAccess', label: 'Is there any mechanical access being used?', type: 'long' },
      { id: 'liftingResponsible', label: 'Who is responsible for the lifting?', type: 'text' },
      { id: 'liftingMethod', label: 'How are we lifting materials on to the roof?', type: 'text' },
      { id: 'labourType', label: 'Direct or Sub-Contract Labour?', type: 'text' },
      { id: 'labourLinedUp', label: 'Do we have labour lined up for this project?', type: 'long' },
      { id: 'manufacturerTickets', label: 'Do we have installers with the appropriate manufacturer tickets?', type: 'long' },
      { id: 'operationsOther', label: 'Anything else?', type: 'long' },
    ],
  },
  {
    id: 'risklog',
    title: 'Risk Log',
    fields: [
      { id: 'risks', label: 'Risks', type: 'risklog' },
    ],
  },
]

// Contact roles seen in the template (used as row labels; free-form allowed).
export const CONTACT_ROLES = [
  'Project Director', 'Project Manager', 'Contracts Manager', 'Quantity Surveyor',
  'Architect', 'Design Manager', 'Façade Manager', 'Site Manager', 'H&S Manager',
  'Sales Rep', 'Technical Rep', 'Regional Manager', 'Area Technical Manager', 'Other',
]

// A blank roof-type block.
export const emptyRoofType = () => ({
  name: '', substrate: '',
  rows: [
    { layer: 'VCL', manufacturer: '', reference: '', thickness: '', calc: '' },
    { layer: 'Insulation', manufacturer: '', reference: '', thickness: '', calc: '' },
    { layer: 'Underlayer', manufacturer: '', reference: '', thickness: '', calc: '' },
    { layer: 'Waterproofing Layer', manufacturer: '', reference: '', thickness: '', calc: '' },
    { layer: 'Method of Attachment', manufacturer: '', reference: '', thickness: '', calc: '' },
    { layer: 'Surface Treatment', manufacturer: '', reference: '', thickness: '', calc: '' },
  ],
})

export default IHM_SECTIONS
