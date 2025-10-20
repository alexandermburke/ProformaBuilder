// Minimal COA synonyms to help auto-map vendor headers → required fields.
export type RequiredField =
  | 'Total Operating Income'
  | 'Total Operating Expense'
  | 'Facility'
  | 'Period'
  | 'Gross Potential Income'
  | 'Net Operating Income'
  | 'Discounts'
  | 'Bad Debt/Rental Refunds'
  | 'Current Management Fees (5.25%)'
  | 'STORE Tenant Protection Split';

export const COA_SYNONYMS: Record<RequiredField, string[]> = {
  'Total Operating Income': [
    'total operating income',
    'operating income total',
    'total income',
    'toi',
    'net revenue',
    'total revenue',
    'income total'
  ],
  'Total Operating Expense': [
    'total operating expense',
    'operating expense total',
    'total expense',
    'toe',
    'expenses total',
    'opex total'
  ],
  Facility: ['facility', 'property', 'site', 'store', 'location'],
  Period: ['period', 'month', 'date', 'statement month', 'report month'],
  'Gross Potential Income': [
    'gross potential income',
    'gpi',
    'gross scheduled rent',
    'potential rent',
    'gross potential revenue'
  ],
  'Net Operating Income': ['net operating income', 'noi', 'net operating profit', 'operating profit'],
  Discounts: ['discounts', 'rent discounts', 'concessions', 'discounts given', 'discounts accrued'],
  'Bad Debt/Rental Refunds': [
    'bad debt',
    'rental refunds',
    'bad debt/rental refunds',
    'write offs',
    'write-offs',
    'rent refunds'
  ],
  'Current Management Fees (5.25%)': [
    'management fees',
    'mgmt fees',
    'current management fees',
    'management fee 5.25',
    'management fee'
  ],
  'STORE Tenant Protection Split': [
    'store tenant protection split',
    'tenant protection split',
    'tenant protection',
    'store tp split',
    'tenant protection revenue'
  ],
};
