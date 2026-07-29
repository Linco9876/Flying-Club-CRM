export const membershipSettingHelp = {
  productName: {
    title: 'Membership name',
    description: 'The public name members see during signup and throughout the portal. Changing it updates the displayed name but does not alter the permanent product code or historical invoices.',
  },
  productCode: {
    title: 'Membership code',
    description: 'A permanent internal identifier used by rules, reports and historical records. It can be chosen only when the product is created, so use a short, stable code that will still make sense in future years.',
  },
  annualFee: {
    title: 'Annual fee',
    description: 'The full financial-year price, including GST. Proration may reduce the first-year charge. A change applies when new financial periods are created and does not rewrite an existing Xero invoice.',
  },
  displayOrder: {
    title: 'Display order',
    description: 'Controls where this product appears in membership lists and signup choices. Lower numbers appear first; it does not change permissions, pricing or approval priority.',
  },
  productDescription: {
    title: 'Membership description',
    description: 'Plain-language guidance shown to applicants so they can choose the correct product. Include who it is intended for and any important eligibility conditions.',
  },
  votingRights: {
    title: 'Voting rights',
    description: 'Marks members in this class as voting members in the register and portal. This should match the Constitution and By-laws; it does not replace meeting eligibility checks.',
  },
  selfBooking: {
    title: 'Aircraft self-booking',
    description: 'Allows financially cleared members in this class to create their own aircraft bookings. Licence, currency, safety, aircraft, duty and supervision rules still apply.',
  },
  feeExempt: {
    title: 'Fee exempt',
    description: 'Makes this product free for every financial year and prevents an annual membership invoice being required. Use this for inherently free classes such as Life membership, not one-off volunteer waivers.',
  },
  productAvailable: {
    title: 'Available for applications',
    description: 'Controls whether this product can be selected for a new application. Turning it off preserves existing memberships and historical records.',
  },
  productXeroItem: {
    title: 'Xero item code',
    description: 'Identifies the Xero item used for this membership invoice line. Use an accountant-approved item with the intended description, tax treatment and revenue mapping. Products may share an item when appropriate.',
  },
  productXeroAccount: {
    title: 'Membership accounting code',
    description: 'Overrides the default Xero income account for this membership product. Leave it blank to use the account configured on the selected Xero item or the portal’s default membership revenue account.',
  },
  financialYearStartMonth: {
    title: 'Financial year start month',
    description: 'Sets the month in which annual membership periods begin. Together with the start day, it determines renewal dates, proration and the financial-year label.',
  },
  financialYearStartDay: {
    title: 'Financial year start day',
    description: 'Sets the day of the selected month on which membership years renew. Days are limited to 1–28 so the date exists in every month.',
  },
  automaticCommencement: {
    title: 'Automatic commencement',
    description: 'If the committee has not approved or rejected a complete application, the system commences membership this many days after submission. Commencement creates the legal register entry and starts billing.',
  },
  nonPaymentGrace: {
    title: 'Non-payment grace period',
    description: 'Legal membership remains current until this many days after the fee due date, then the lifecycle may cease it if fresh Xero data still shows unpaid. Aircraft self-booking is blocked while the fee is unpaid.',
  },
  prorationMethod: {
    title: 'New-member proration',
    description: 'Controls how the first fee is reduced between commencement and the end of the current membership year: exact daily proportion, whole months remaining, or no reduction.',
  },
  minimumProratedFee: {
    title: 'Minimum prorated fee',
    description: 'Sets the lowest first-year fee after proration, including GST. Use $0 when a very late-year applicant may pay less than any fixed minimum.',
  },
  renewalInvoiceLead: {
    title: 'Prepare invoices',
    description: 'How many days before renewal the system prepares annual Xero invoices. This gives members advance notice; automatic card or BECS collection still waits until the due date.',
  },
  upcomingReminders: {
    title: 'Upcoming reminders',
    description: 'Comma-separated days before the due date when reminder processing should notify members. For example, “30, 7” means reminders 30 days and 7 days before payment is due.',
  },
  overdueReminders: {
    title: 'Overdue reminders',
    description: 'Comma-separated days after the due date when unpaid members should be reminded. These reminders do not extend the non-payment grace period.',
  },
  technicalRetries: {
    title: 'Technical retry minutes',
    description: 'Comma-separated delays used after temporary system, network, Stripe or Xero interruptions. Retries preserve the same idempotency key so they cannot create a duplicate invoice or charge.',
  },
  paymentRetries: {
    title: 'Payment retry days',
    description: 'Comma-separated delays used after a genuine card or bank-debit failure. These are slower than technical retries and should leave members enough time to correct their payment method.',
  },
  xeroStaleAfter: {
    title: 'Xero status stale after',
    description: 'The maximum age of cached Xero payment information. If the last successful refresh is older than this, automatic membership cessation is paused to avoid cancelling someone on outdated data.',
  },
  scholarshipAvailable: {
    title: 'Offer scholarship contributions',
    description: 'Shows an optional scholarship contribution during payment setup. It is always unchecked by default and is recorded separately from the membership fee.',
  },
  scholarshipSuggested: {
    title: 'Suggested contribution',
    description: 'The amount prefilled after a member actively chooses to contribute. The member can change it to any amount at or above the configured minimum.',
  },
  scholarshipMinimum: {
    title: 'Minimum contribution',
    description: 'The smallest scholarship contribution the portal accepts. It must be positive and cannot exceed the suggested amount.',
  },
  scholarshipXeroItem: {
    title: 'Scholarship Xero item code',
    description: 'The Xero item used for the separate scholarship contribution invoice line. Keep it distinct from membership items when separate reporting or tax treatment is required.',
  },
  scholarshipXeroAccount: {
    title: 'Scholarship accounting code',
    description: 'Overrides the default Xero revenue account for scholarship contributions. Select the account approved by the club’s accountant, or leave blank to use the configured default.',
  },
  waiverTypes: {
    title: 'Approved waiver types',
    description: 'The controlled list administrators choose from when granting a fee waiver, one category per line. Categories make complimentary memberships consistent and reportable; the administrator must still record a reason.',
  },
  waiverAuthority: {
    title: 'Require waiver authority reference',
    description: 'Requires the administrator to record evidence such as a committee minute or delegated approval before a fee waiver can be saved.',
  },
  registerCleanup: {
    title: 'Register cleanup target',
    description: 'The operational target, in days, for privacy-minimising ceased-member information after it is no longer required. Statutory register facts and auditable financial records remain preserved as required.',
  },
  rolloutMode: {
    title: 'Booking enforcement mode',
    description: 'Controls how club-membership status affects aircraft bookings. Information only records status, staff warning asks staff to review it, and enforced blocks member self-booking when membership or payment requirements are not met. Guest and staff override rules remain separate.',
  },
  staffOverrideReason: {
    title: 'Require a staff override reason',
    description: 'Requires an instructor or administrator to explain why they are booking for an unpaid member or non-member. The reason, staff member, time and eligibility snapshot are retained for audit.',
  },
} as const;

export type MembershipSettingHelpKey = keyof typeof membershipSettingHelp;
