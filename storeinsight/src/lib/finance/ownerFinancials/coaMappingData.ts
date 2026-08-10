/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

// COA mapping tables for the Owner Financials Extractor.
//
// These are the etlpipelines mapping CSVs transcribed verbatim:
//   approved_mappings_exr.csv / alias_mappings_exr.csv  -> exr
//   approved_mappings_ps.csv  / alias_mappings_ps.csv   -> ps
//   approved_mappings_cs.csv  / alias_mappings_cs.csv   -> cs  (header only, empty)
//
// HOW TO MAINTAIN THIS SYSTEM
//   * To add or correct a known mapping: add/edit a row in APPROVED_MAPPINGS.
//   * To add an alternate spelling:      add a row in ALIAS_MAPPINGS.
//   * No mapper changes are needed for routine updates.
//
// Row order matters. The normalized lookup keeps the FIRST entry when two
// source labels normalize identically, and the fuzzy pass breaks score ties in
// favour of the earlier row, so keep additions at the end of a section.
//
// accountType values: Income | Expense | EXR_Rollup | PS_Rollup. Rollup rows are
// subtotals the source system already calculated - they are tagged but must not
// be aggregated in the model (double-counting risk).

import type { AliasMappingRow, ApprovedMappingEntry, ManagedBy } from './types';

export type CoaTableKey = 'exr' | 'ps' | 'cs';

const APPROVED_EXR: ApprovedMappingEntry[] = [
  {
    sourceLabel: 'Average Sq. Ft. Occupancy (9992)',
    coa: 'Occupancy SqFt',
    coa2: '',
    accountType: 'Income',
    notes: 'Average square footage occupancy metric — precedes income statement rows',
  },
  {
    sourceLabel: 'Rental Income (4000)',
    coa: 'Rental Income',
    coa2: '',
    accountType: 'Income',
    notes: 'Core storage unit rental revenue',
  },
  {
    sourceLabel: 'Rental Refunds (4090)',
    coa: 'Rental Income',
    coa2: '',
    accountType: 'Income',
    notes: 'Contra-revenue — tenant refunds reduce gross rental income',
  },
  {
    sourceLabel: 'Discounts Charged (4250)',
    coa: 'Discounts',
    coa2: '',
    accountType: 'Income',
    notes: 'Move-in specials and promotional concessions',
  },
  {
    sourceLabel: 'Bad Debt Expense (4990)',
    coa: 'Bad Debt',
    coa2: '',
    accountType: 'Income',
    notes:
      'Not in COA Translation — verify treatment in your model (may combine with Discounts)',
  },
  {
    sourceLabel: 'Administrative Fees (4310)',
    coa: 'Admin Fee Income',
    coa2: '',
    accountType: 'Income',
    notes: 'Gross admin fees charged to tenants',
  },
  {
    sourceLabel: 'Admin Fees Waived (4360)',
    coa: 'Admin Fee Income',
    coa2: '',
    accountType: 'Income',
    notes: 'Contra-account — offsets gross admin fees (4310)',
  },
  {
    sourceLabel: 'Late Fees (4300)',
    coa: 'Late Fee Income',
    coa2: '',
    accountType: 'Income',
    notes: 'Gross late fees charged to tenants',
  },
  {
    sourceLabel: 'Late Fees Waived (4350)',
    coa: 'Late Fee Income',
    coa2: '',
    accountType: 'Income',
    notes: 'Contra-account — offsets gross late fees (4300)',
  },
  {
    sourceLabel: 'Other Fees (4305)',
    coa: 'Other Tenant Income',
    coa2: '',
    accountType: 'Income',
    notes: 'Gross other miscellaneous fees charged to tenants',
  },
  {
    sourceLabel: 'Other Fees Waived (4355)',
    coa: 'Other Tenant Income',
    coa2: '',
    accountType: 'Income',
    notes: 'Contra-account — offsets gross other fees (4305)',
  },
  {
    sourceLabel: 'Merchandise Sales (4320)',
    coa: 'Retail Sales Income',
    coa2: '',
    accountType: 'Income',
    notes: 'Merchandise and retail supply sales',
  },
  {
    sourceLabel: 'Lock & Pack',
    coa: 'Retail Sales Income',
    coa2: '',
    accountType: 'Income',
    notes: 'Lock and packing supply retail sales',
  },
  {
    sourceLabel: 'Other Income (4980)',
    coa: 'Other Tenant Income',
    coa2: '',
    accountType: 'Income',
    notes: 'Miscellaneous other operating income',
  },
  {
    sourceLabel: 'Rental Income - Parking (4020)',
    coa: 'Rental Income',
    coa2: '',
    accountType: 'Income',
    notes: 'Parking rental — combine with storage rental income per COA Translation',
  },
  {
    sourceLabel: 'Manager Payroll (5000)',
    coa: 'Payroll',
    coa2: '',
    accountType: 'Expense',
    notes: 'Site manager base payroll',
  },
  {
    sourceLabel: 'Overtime (5005)',
    coa: 'Payroll',
    coa2: '',
    accountType: 'Expense',
    notes: 'Manager and staff overtime pay',
  },
  {
    sourceLabel: 'Vacation & Personal Leave (5010)',
    coa: 'Payroll',
    coa2: '',
    accountType: 'Expense',
    notes: 'PTO and vacation pay accruals',
  },
  {
    sourceLabel: 'Performance Bonus (5030)',
    coa: 'Payroll',
    coa2: '',
    accountType: 'Expense',
    notes: 'Annual and periodic performance bonuses',
  },
  {
    sourceLabel: '401K Match (5035)',
    coa: 'Payroll',
    coa2: '',
    accountType: 'Expense',
    notes: 'Employer 401K contribution',
  },
  {
    sourceLabel: 'Employee Incentives (5050)',
    coa: 'Payroll',
    coa2: '',
    accountType: 'Expense',
    notes: 'Employee incentive pay and spot bonuses',
  },
  {
    sourceLabel: 'Workmans Compensation (5070)',
    coa: 'Payroll',
    coa2: '',
    accountType: 'Expense',
    notes: 'Workers compensation insurance premiums',
  },
  {
    sourceLabel: 'Group Health & Life Insurance (5080)',
    coa: 'Payroll',
    coa2: '',
    accountType: 'Expense',
    notes: 'Employee health and life insurance benefits',
  },
  {
    sourceLabel: 'Payroll Tax (5090)',
    coa: 'Payroll',
    coa2: '',
    accountType: 'Expense',
    notes: 'Employer FICA/FUTA/SUTA payroll taxes',
  },
  {
    sourceLabel: 'Management Fee - ESMI (5100)',
    coa: 'Current Mgmt. Fee',
    coa2: '',
    accountType: 'Expense',
    notes: 'Third-party management fee paid to ESMI',
  },
  {
    sourceLabel: 'Other Advertising (5210)',
    coa: 'Advertising & Marketing',
    coa2: '',
    accountType: 'Expense',
    notes: 'Traditional and non-digital advertising spend',
  },
  {
    sourceLabel: 'Internet & Call Center (5220)',
    coa: 'Advertising & Marketing',
    coa2: '',
    accountType: 'Expense',
    notes: 'Digital marketing and national call center costs',
  },
  {
    sourceLabel: 'Electricity (5300)',
    coa: 'Utilities',
    coa2: '',
    accountType: 'Expense',
    notes: 'Electric utility — see also Utilities EXR subtotal',
  },
  {
    sourceLabel: 'Water & Sewer (5320)',
    coa: 'Utilities',
    coa2: '',
    accountType: 'Expense',
    notes: 'Water and sewer utility — see also Utilities EXR subtotal',
  },
  {
    sourceLabel: 'Office Supplies & Expense (5400)',
    coa: 'Office Supplies',
    coa2: '',
    accountType: 'Expense',
    notes: 'Office supplies and general administrative supplies',
  },
  {
    sourceLabel: 'Postage/Express Delivery (5410)',
    coa: 'Office Supplies',
    coa2: '',
    accountType: 'Expense',
    notes: 'Postage and express shipping costs',
  },
  {
    sourceLabel: 'Bank Charges (5430)',
    coa: 'Bank Charges',
    coa2: '',
    accountType: 'Expense',
    notes: 'Bank service charges and fees',
  },
  {
    sourceLabel: 'Credit Card Merchant Fees (5435)',
    coa: 'Current Payment Processing Fees',
    coa2: '',
    accountType: 'Expense',
    notes: 'Credit and debit card processing costs',
  },
  {
    sourceLabel: 'Legal & Professional (5440)',
    coa: 'Prof Fees - Legal/Acctg',
    coa2: '',
    accountType: 'Expense',
    notes: 'Legal and accounting professional fees',
  },
  {
    sourceLabel: 'Operational Fees, Licenses & Taxes (5450)',
    coa: 'Licenses & Permits',
    coa2: '',
    accountType: 'Expense',
    notes: 'Business licenses and operational taxes',
  },
  {
    sourceLabel: 'Recruiting (5460)',
    coa: 'Recruiting',
    coa2: '',
    accountType: 'Expense',
    notes: 'Job posting and recruiting expenses',
  },
  {
    sourceLabel: 'Employee Relations (5470)',
    coa: 'Other Expense',
    coa2: '',
    accountType: 'Expense',
    notes: 'Employee engagement and morale expenses',
  },
  {
    sourceLabel: 'Training (5475)',
    coa: 'Other Expense',
    coa2: '',
    accountType: 'Expense',
    notes: 'Employee training and certification costs',
  },
  {
    sourceLabel: 'Business Travel (5490)',
    coa: 'Other Expense',
    coa2: '',
    accountType: 'Expense',
    notes: 'Business travel and lodging costs',
  },
  {
    sourceLabel: 'Telecom (5500)',
    coa: 'Telephone & Internet',
    coa2: '',
    accountType: 'Expense',
    notes: 'Phone and internet service for the property',
  },
  {
    sourceLabel: 'Computer (5550)',
    coa: 'Software',
    coa2: '',
    accountType: 'Expense',
    notes: 'Software subscriptions and computer equipment costs',
  },
  {
    sourceLabel: 'Repairs & Maintenance (5600)',
    coa: 'Repairs & Maintenance',
    coa2: '',
    accountType: 'Expense',
    notes: 'General facility repairs and maintenance',
  },
  {
    sourceLabel: 'Lighting / Electrical (5605)',
    coa: 'Repairs & Maintenance',
    coa2: '',
    accountType: 'Expense',
    notes: 'Lighting and electrical system repairs',
  },
  {
    sourceLabel: 'Trash Removal (5610)',
    coa: 'Utilities',
    coa2: '',
    accountType: 'Expense',
    notes: 'Trash and waste removal — see also Utilities EXR subtotal',
  },
  {
    sourceLabel: 'Unit Doors (5615)',
    coa: 'Repairs & Maintenance',
    coa2: '',
    accountType: 'Expense',
    notes: 'Storage unit door repairs and replacements',
  },
  {
    sourceLabel: 'Landscaping Maintenance (5620)',
    coa: 'Repairs & Maintenance',
    coa2: '',
    accountType: 'Expense',
    notes: 'Grounds and landscaping maintenance',
  },
  {
    sourceLabel: 'Snow Removal (5630)',
    coa: 'Repairs & Maintenance',
    coa2: '',
    accountType: 'Expense',
    notes: 'Snow plowing and ice management',
  },
  {
    sourceLabel: 'Pest Control (5640)',
    coa: 'Repairs & Maintenance',
    coa2: '',
    accountType: 'Expense',
    notes: 'Pest prevention and extermination services',
  },
  {
    sourceLabel: 'Elevator Maintenance (5650)',
    coa: 'Repairs & Maintenance',
    coa2: '',
    accountType: 'Expense',
    notes: 'Elevator service contracts and repairs',
  },
  {
    sourceLabel: 'HVAC Repairs (5655)',
    coa: 'Repairs & Maintenance',
    coa2: '',
    accountType: 'Expense',
    notes: 'Heating and cooling system repairs',
  },
  {
    sourceLabel: 'Security System (5660)',
    coa: 'Security',
    coa2: '',
    accountType: 'Expense',
    notes: 'Security monitoring system and equipment costs',
  },
  {
    sourceLabel: 'Gate & Fence (5665)',
    coa: 'Repairs & Maintenance',
    coa2: '',
    accountType: 'Expense',
    notes: 'Gate access system and fence repairs',
  },
  {
    sourceLabel: 'Fire Prevention (5670)',
    coa: 'Fire Prevention',
    coa2: '',
    accountType: 'Expense',
    notes: 'Fire suppression system inspections and service',
  },
  {
    sourceLabel: 'Painting (5680)',
    coa: 'Repairs & Maintenance',
    coa2: '',
    accountType: 'Expense',
    notes: 'Interior and exterior painting and touch-up',
  },
  {
    sourceLabel: 'Auction (5700)',
    coa: 'Auction',
    coa2: '',
    accountType: 'Expense',
    notes: 'Lien sale and auction costs',
  },
  {
    sourceLabel: 'Auctioneer (5705)',
    coa: 'Other Expense',
    coa2: '',
    accountType: 'Expense',
    notes: 'Auctioneer fees for lien sales',
  },
  {
    sourceLabel: 'Resale Merchandise (5740)',
    coa: 'Retail Products',
    coa2: '',
    accountType: 'Expense',
    notes: 'Cost of retail merchandise and supplies sold',
  },
  {
    sourceLabel: 'Property & Casualty Insurance (5785)',
    coa: 'Insurance',
    coa2: '',
    accountType: 'Expense',
    notes: 'Property and casualty insurance premium',
  },
  {
    sourceLabel: 'NRI',
    coa: 'Net Rental Income',
    coa2: 'Net Rental Income',
    accountType: 'EXR_Rollup',
    notes:
      'EXR net rental income subtotal — do not aggregate in model (detail lines captured separately)',
  },
  {
    sourceLabel: 'Admin Fees',
    coa: 'Admin Fee Income',
    coa2: '',
    accountType: 'EXR_Rollup',
    notes:
      'EXR net admin fees subtotal — do not aggregate in model (detail lines captured separately)',
  },
  {
    sourceLabel: 'Late Fees',
    coa: 'Late Fee Income',
    coa2: '',
    accountType: 'EXR_Rollup',
    notes:
      'EXR net late fees subtotal — do not aggregate in model (detail lines captured separately)',
  },
  {
    sourceLabel: 'Other Fees',
    coa: 'Other Tenant Income',
    coa2: '',
    accountType: 'EXR_Rollup',
    notes:
      'EXR net other fees subtotal — do not aggregate in model (detail lines captured separately)',
  },
  {
    sourceLabel: 'Revenue - Property',
    coa: 'Total Operating Income',
    coa2: 'Total Operating Income',
    accountType: 'EXR_Rollup',
    notes:
      'EXR total revenue rollup — do not aggregate in model (individual income lines captured separately)',
  },
  {
    sourceLabel: 'Payroll',
    coa: 'Payroll',
    coa2: '',
    accountType: 'EXR_Rollup',
    notes: 'EXR payroll subtotal (5000-5090) — do not aggregate in model',
  },
  {
    sourceLabel: 'Management Fees',
    coa: 'Current Mgmt. Fee',
    coa2: '',
    accountType: 'EXR_Rollup',
    notes: 'EXR management fee subtotal — do not aggregate in model',
  },
  {
    sourceLabel: 'Marketing',
    coa: 'Advertising & Marketing',
    coa2: '',
    accountType: 'EXR_Rollup',
    notes: 'EXR marketing subtotal (5210 + 5220) — do not aggregate in model',
  },
  {
    sourceLabel: 'Office & Employee',
    coa: 'Office Supplies',
    coa2: '',
    accountType: 'EXR_Rollup',
    notes: 'EXR office and employee expense subtotal — do not aggregate in model',
  },
  {
    sourceLabel: 'Administrative',
    coa: 'Other Expense',
    coa2: '',
    accountType: 'EXR_Rollup',
    notes: 'EXR broader administrative expense subtotal — do not aggregate in model',
  },
  {
    sourceLabel: 'R&M',
    coa: 'Repairs & Maintenance',
    coa2: '',
    accountType: 'EXR_Rollup',
    notes: 'EXR R&M subtotal (5600-5680) — do not aggregate in model',
  },
  {
    sourceLabel: 'Utilities',
    coa: 'Utilities',
    coa2: '',
    accountType: 'EXR_Rollup',
    notes: 'EXR utilities subtotal (5300 + 5320 + 5610) — do not aggregate in model',
  },
  {
    sourceLabel: 'Other',
    coa: 'Other Expense',
    coa2: '',
    accountType: 'EXR_Rollup',
    notes: 'EXR miscellaneous expense subtotal — do not aggregate in model',
  },
  {
    sourceLabel: 'Expense - Property',
    coa: 'Total Operating Expense',
    coa2: 'Total Operating Expense',
    accountType: 'EXR_Rollup',
    notes:
      'EXR total operating expense rollup — do not aggregate in model (individual expense lines captured separately)',
  },
  {
    sourceLabel: 'Net Operating Income',
    coa: 'Net Operating Income',
    coa2: 'Net Operating Income',
    accountType: 'EXR_Rollup',
    notes:
      'EXR calculated NOI — do not aggregate in model (derived from income minus expenses)',
  },
];

const ALIAS_EXR: AliasMappingRow[] = [
  {
    alias: 'Management Fee',
    canonicalLabel: 'Management Fee - ESMI (5100)',
    notes: 'Common shorthand without company name',
  },
  {
    alias: 'Mgmt Fee',
    canonicalLabel: 'Management Fee - ESMI (5100)',
    notes: 'Common shorthand',
  },
  {
    alias: 'Mgmt. Fee',
    canonicalLabel: 'Management Fee - ESMI (5100)',
    notes: 'Common shorthand with period',
  },
  {
    alias: 'ESMI Management Fee',
    canonicalLabel: 'Management Fee - ESMI (5100)',
    notes: 'Alternative label ordering',
  },
  {
    alias: 'Property Insurance',
    canonicalLabel: 'Property & Casualty Insurance (5785)',
    notes: 'Common shorthand',
  },
  {
    alias: 'P&C Insurance',
    canonicalLabel: 'Property & Casualty Insurance (5785)',
    notes: 'Industry abbreviation',
  },
  {
    alias: 'General Liability Insurance',
    canonicalLabel: 'Property & Casualty Insurance (5785)',
    notes: 'Alternative insurance label',
  },
  {
    alias: 'Bank Fees',
    canonicalLabel: 'Bank Charges (5430)',
    notes: 'Common alternative label',
  },
  {
    alias: 'Credit Card Fees',
    canonicalLabel: 'Credit Card Merchant Fees (5435)',
    notes: 'Common shorthand',
  },
  {
    alias: 'CC Processing',
    canonicalLabel: 'Credit Card Merchant Fees (5435)',
    notes: 'Common abbreviation',
  },
  {
    alias: 'Web Marketing',
    canonicalLabel: 'Internet & Call Center (5220)',
    notes: 'Common digital marketing label',
  },
  {
    alias: 'Online Marketing',
    canonicalLabel: 'Internet & Call Center (5220)',
    notes: 'Common digital marketing label',
  },
  {
    alias: 'Software Subscriptions',
    canonicalLabel: 'Computer (5550)',
    notes: 'Common alternative for software costs',
  },
  {
    alias: 'Rental Income',
    canonicalLabel: 'Rental Income (4000)',
    notes: 'Label without GL code suffix',
  },
  {
    alias: 'Late Fee Income',
    canonicalLabel: 'Late Fees (4300)',
    notes: 'Target-side COA label used as source label',
  },
  {
    alias: 'Admin Fee Income',
    canonicalLabel: 'Administrative Fees (4310)',
    notes: 'Target-side COA label used as source label',
  },
];

const APPROVED_PS: ApprovedMappingEntry[] = [
  {
    sourceLabel: 'Rental Income',
    coa: 'Rental Income',
    coa2: 'Net Rental Income',
    accountType: 'Income',
    notes: 'Core storage unit rental revenue',
  },
  {
    sourceLabel: 'Tenant Insurance RMASA Fee',
    coa: 'Current Tenant Protection Split',
    coa2: '',
    accountType: 'Income',
    notes: 'Tenant protection plan revenue split',
  },
  {
    sourceLabel: 'Merchandise Sales',
    coa: 'Retail Sales Income',
    coa2: '',
    accountType: 'Income',
    notes: 'Merchandise and retail supply sales',
  },
  {
    sourceLabel: 'Admin Fees, Late Fees, and Other Fees',
    coa: 'Admin Fee Income',
    coa2: '',
    accountType: 'Income',
    notes: 'Combined admin/late/other fees — PS reports as one line',
  },
  {
    sourceLabel: 'Total Revenue',
    coa: 'Total Operating Income',
    coa2: 'Total Operating Income',
    accountType: 'PS_Rollup',
    notes: 'PS total revenue subtotal — do not aggregate in model',
  },
  {
    sourceLabel: 'Property Management Software',
    coa: 'Software',
    coa2: '',
    accountType: 'Expense',
    notes: 'Property management software subscription',
  },
  {
    sourceLabel: 'Customer Care Center',
    coa: 'Software',
    coa2: '',
    accountType: 'Expense',
    notes: 'National call center and customer care costs',
  },
  {
    sourceLabel: 'Management Fees',
    coa: 'Current Mgmt. Fee',
    coa2: '',
    accountType: 'Expense',
    notes: 'Third-party management fee paid to PS',
  },
  {
    sourceLabel: 'Total Contractually set fees',
    coa: '',
    coa2: '',
    accountType: 'PS_Rollup',
    notes: 'PS contractually set fees subtotal — do not aggregate in model',
  },
  {
    sourceLabel: 'Cost of Goods Sold',
    coa: 'Retail Products',
    coa2: '',
    accountType: 'Expense',
    notes: 'Cost of retail merchandise sold',
  },
  {
    sourceLabel: 'Payroll - Property Manager',
    coa: 'Payroll',
    coa2: '',
    accountType: 'Expense',
    notes: 'Site property manager payroll',
  },
  {
    sourceLabel: 'Payroll - District Manager',
    coa: 'Current Mgmt. Fee',
    coa2: '',
    accountType: 'Expense',
    notes:
      'District manager payroll allocated to property — mapped to mgmt fee per COA Translation',
  },
  {
    sourceLabel: 'Utilities',
    coa: 'Utilities',
    coa2: '',
    accountType: 'Expense',
    notes: 'All utility costs combined',
  },
  {
    sourceLabel: 'Repairs and Maintenance',
    coa: 'Repairs & Maintenance',
    coa2: '',
    accountType: 'Expense',
    notes: 'General facility repairs and maintenance',
  },
  {
    sourceLabel: 'Credit Card Charges',
    coa: 'Current Credit Card Security Fees',
    coa2: '',
    accountType: 'Expense',
    notes: 'Credit and debit card processing costs',
  },
  {
    sourceLabel: 'Internet Advertising',
    coa: 'Advertising & Marketing',
    coa2: '',
    accountType: 'Expense',
    notes: 'Digital and internet advertising spend',
  },
  {
    sourceLabel: 'Network Charges',
    coa: 'Software',
    coa2: '',
    accountType: 'Expense',
    notes: 'Network infrastructure charges — mapped to software per COA Translation',
  },
  {
    sourceLabel: 'Bank Charges',
    coa: 'Software',
    coa2: '',
    accountType: 'Expense',
    notes: 'Bank service charges — mapped to software per COA Translation',
  },
  {
    sourceLabel: 'Telephone',
    coa: 'Telephone & Internet',
    coa2: '',
    accountType: 'Expense',
    notes: 'Phone and internet service for the property',
  },
  {
    sourceLabel: 'Tenant Mailings',
    coa: 'Payroll',
    coa2: '',
    accountType: 'Expense',
    notes: 'Tenant mailing costs — mapped to payroll per COA Translation',
  },
  {
    sourceLabel: 'Office Expense',
    coa: 'Office Supplies',
    coa2: '',
    accountType: 'Expense',
    notes: 'Office supplies and general administrative costs',
  },
  {
    sourceLabel: 'Business Licenses and Permits',
    coa: 'Licenses & Permits',
    coa2: '',
    accountType: 'Expense',
    notes: 'Business licenses and operational taxes',
  },
  {
    sourceLabel: 'Legal and Evictions',
    coa: 'Prof Fees - Legal/Acctg',
    coa2: '',
    accountType: 'Expense',
    notes: 'Legal fees and eviction costs',
  },
  {
    sourceLabel: 'Total Other Expenses',
    coa: '',
    coa2: '',
    accountType: 'PS_Rollup',
    notes: 'PS other expenses subtotal — do not aggregate in model',
  },
  {
    sourceLabel: 'Total Operating Expenses',
    coa: 'Total Operating Expense',
    coa2: 'Total Operating Expense',
    accountType: 'PS_Rollup',
    notes: 'PS total operating expense rollup — do not aggregate in model',
  },
  {
    sourceLabel: 'Net Operating Income',
    coa: 'Net Operating Income',
    coa2: 'Net Operating Income',
    accountType: 'PS_Rollup',
    notes: 'PS calculated NOI — do not aggregate in model',
  },
];

/** approved_mappings_cs.csv currently holds only its header row. */
const APPROVED_CS: ApprovedMappingEntry[] = [];

/** alias_mappings_ps.csv and alias_mappings_cs.csv currently hold only their header rows. */
const ALIAS_PS: AliasMappingRow[] = [];
const ALIAS_CS: AliasMappingRow[] = [];

export const APPROVED_MAPPINGS: Record<CoaTableKey, ApprovedMappingEntry[]> = {
  exr: APPROVED_EXR,
  ps: APPROVED_PS,
  cs: APPROVED_CS,
};

export const ALIAS_MAPPINGS: Record<CoaTableKey, AliasMappingRow[]> = {
  exr: ALIAS_EXR,
  ps: ALIAS_PS,
  cs: ALIAS_CS,
};

/**
 * Maps each Managed By option to its mapping table.
 * null means skip COA mapping for that manager (manual review required).
 */
export const COA_TABLE_BY_MANAGER: Record<ManagedBy, CoaTableKey | null> = {
  Extra: 'exr',
  'Public Storage': 'ps',
  CubeSmart: 'cs',
  Other: null,
};
