// Standard invoice chase-email templates for the Outstanding Invoices page.
// Stored (when edited) under Redis key 'config:chase-email-templates'; these are
// the code defaults used until an admin edits them in the Commercial portal.
//
// Merge fields available in subject/body (replaced at send time):
//   [Customer First Name]  [Customer Company Name]  [Customer Address]
//   [Customer QS Name]     [Customer QS Email]
//   [Invoice Number]       [Invoice Reference]      [Project Name]
//   [Project Address]      [Sub-Contract Ref]       [Due Date]
//   [Today's Date]         [Invoice Value]          [Invoice Value inc VAT]
//   [Rock Roofing QS Name]

export const CHASE_MERGE_FIELDS = [
  '[Customer First Name]', '[Customer Company Name]', '[Customer Address]',
  '[Customer QS Name]', '[Customer QS Email]',
  '[Invoice Number]', '[Invoice Reference]', '[Project Name]', '[Project Address]',
  '[Sub-Contract Ref]', '[Due Date]', "[Today's Date]",
  '[Invoice Value]', '[Invoice Value inc VAT]', '[Rock Roofing QS Name]',
]

// Each template: { key, label, ccSiteManager, ccRockCM, subject, body }
// ccSiteManager / ccRockCM indicate the DEFAULT auto-CCs for that stage (the
// user can still add/remove recipients in the compose popup).
export const CHASE_TEMPLATES = [
  {
    key: 'upcoming',
    label: 'Upcoming invoice',
    ccSiteManager: false,
    ccRockCM: false,
    subject: 'Upcoming invoice [Invoice Number] — [Project Name]',
    body: `Hi [Customer First Name],

A quick email to confirm that our upcoming invoice ref [Invoice Number] for project ref [Project Name] will be paid when it falls due on [Due Date]?

Please advise if you are anticipating anything different to what has been agreed.

Kind Regards,

[Rock Roofing QS Name]`,
  },
  {
    key: 'overdue1',
    label: 'Overdue 1',
    ccSiteManager: true,
    ccRockCM: true,
    subject: 'Overdue invoice [Invoice Number] — [Project Name]',
    body: `Hi [Customer First Name],

Please can you provide a payment date for our invoice ref [Invoice Number] for project ref [Project Name]. This invoice fell due on [Due Date].

Kind Regards,

[Rock Roofing QS Name]`,
  },
  {
    key: 'overdue2',
    label: 'Overdue 2',
    ccSiteManager: true,
    ccRockCM: true,
    subject: 'Overdue invoice [Invoice Number] — [Project Name] (follow up)',
    body: `Hi [Customer First Name],

A quick follow up to confirm a payment date for our invoice ref [Invoice Number] for project ref [Project Name]. This invoice fell due on [Due Date].

Kind Regards,

[Rock Roofing QS Name]`,
  },
  {
    key: 'overdue3',
    label: 'Overdue 3',
    ccSiteManager: true,
    ccRockCM: true,
    subject: 'Overdue invoice [Invoice Number] — [Project Name] (escalation)',
    body: `Hi [Customer First Name],

Please confirm a payment date for our invoice ref [Invoice Number] for project ref [Project Name]. This invoice fell due on [Due Date].

We follow a standard process for overdue emails that I have to follow when a payment date is not confirmed. Our next step means I have to escalate and consider withdrawal from site / warranty requirements.

Keen to avoid this, so please come back to me ASAP with a confirmed payment date.

Kind Regards,

[Rock Roofing QS Name]`,
  },
  {
    key: 'withdrawal',
    label: 'Withdrawal from Contractual Obligations',
    ccSiteManager: true,
    ccRockCM: true,
    subject: 'NOTICE — Suspension of performance for non-payment — [Project Name] — Invoice [Invoice Reference]',
    body: `[Customer Company Name]
[Customer Address]
Date: [Today's Date]

For the attention of:
[Customer QS Name] – Quantity Surveyor – [Customer QS Email]

Project Name: [Project Name]
Subcontract Ref: [Sub-Contract Ref]
Invoice ref: [Invoice Reference]

Amount Overdue: [Invoice Value inc VAT]

Dear Sirs,

This notice is being issued for the missed/less payments for the [Project Name] project at [Project Address] as stated in the above referenced invoice.

In accordance with 'Section 112 – Right to suspend performance for non-payment' of the Housing Grants, Construction and Regeneration Act 1996, we hereby give you 7 days clear notice that should payment of the full amount specified not be received within the next 7 days, we shall have no option but to suspend the performance of all our obligations under the Sub-Contract until such time as payment is made in full.

The grounds for such suspension being that the amount set out above became payable and [Customer Company Name] have failed to make payment.

Should we be obliged to suspend, we will be entitled to an appropriate extension of time and to recover any associated loss and/or expense in accordance with sub-sections 3A & 4 of Section 112.

In addition to this we are also entitled to claim interest at the rate of the bank of England base rate on the sum due in accordance 'Section 6 – Rate of statutory interest' of the Late Payment of Commercial Debts (Interest) Act 1998 and a fixed sum of £100.00 (if sums due is more than £10,000.00) in accordance with 'Section 5A – Compensation arising out of late payment' of the Late Payment of Commercial Debts (Interest) Act 1998 until the payment is made in full plus applicable VAT.

We trust that this action will not be required, and we request your immediate payment of [Invoice Value inc VAT] for the attached outstanding invoice.

Yours Sincerely,

[Rock Roofing QS Name]`,
  },
]

export function defaultChaseTemplates() {
  // Deep copy so callers can't mutate the module defaults.
  return JSON.parse(JSON.stringify(CHASE_TEMPLATES))
}
