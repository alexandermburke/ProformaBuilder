export type WorkflowTone = 'blue' | 'purple' | 'green' | 'amber';
export type WorkflowIconKey =
  | 'document'
  | 'layers'
  | 'globe'
  | 'target'
  | 'bank'
  | 'spreadsheet'
  | 'receipt'
  | 'clipboard';

export type WorkflowCard = {
  id: string;
  title: string;
  description: string;
  status: string;
  tone: WorkflowTone;
  icon: WorkflowIconKey;
  highlights: string[];
  href?: string;
  disabled?: boolean;
};

export type WorkflowCategoryKey = 'accounting' | 'finance' | 'other' | 'reporting';

export type WorkflowCategory = {
  key: WorkflowCategoryKey;
  href: string;
  title: string;
  summaryDescription: string;
  summaryHighlights: string[];
  summaryTone: WorkflowTone;
  summaryIcon: WorkflowIconKey;
  pageBadge: string;
  pageTitle: string;
  pageDescription: string;
  features: WorkflowCard[];
};

export const workflowCategories: WorkflowCategory[] = [
  {
    key: 'accounting',
    href: '/accounting',
    title: 'Accounting',
    summaryDescription: 'Import prep, approvals, and reconciliation workflows for Yardi-bound accounting activity.',
    summaryHighlights: ['Bank & Card Import Prep', 'Payables automation', 'Reconciliation review'],
    summaryTone: 'blue',
    summaryIcon: 'bank',
    pageBadge: 'Automated accounting',
    pageTitle: 'Choose your accounting workflow.',
    pageDescription:
      'Select the accounting system you want to run. Each option launches a focused workflow for preparing data, reviewing exceptions, and exporting to Yardi.',
    features: [
      {
        id: 'bank-card-import-prep',
        title: 'Bank & Card Import Prep',
        description: 'Standardize bank and credit card activity for Yardi-ready imports.',
        status: 'Active',
        tone: 'blue',
        icon: 'bank',
        highlights: [
          'Separate exports for bank, card, and other bank activity.',
          'Owner-friendly notes cleanup with tenant deposit rules.',
          'Per-source review counts and downloadable workbooks.',
        ],
        href: '/accounting/bank-card-import-prep',
      },
      {
        id: 'payables-automation',
        title: 'Payables automation',
        description: 'Queue invoices, map vendors, and prep approvals in one flow.',
        status: 'Planned',
        tone: 'purple',
        icon: 'receipt',
        highlights: [
          'Vendor normalization with GL suggestions.',
          'Approval routing and audit-ready trails.',
          'Exports aligned to Yardi payables.',
        ],
        disabled: true,
      },
      {
        id: 'reconciliation-review',
        title: 'Reconciliation review',
        description: 'Match deposits and cash activity before posting.',
        status: 'Planned',
        tone: 'amber',
        icon: 'clipboard',
        highlights: [
          'Variance flags with transaction context.',
          'Batch review before posting to Yardi.',
          'Portfolio-wide reconciliation view.',
        ],
        disabled: true,
      },
    ],
  },
  {
    key: 'finance',
    href: '/finance',
    title: 'Finance',
    summaryDescription: 'Planning, owner reporting, and benchmarking workflows for underwriting and asset performance.',
    summaryHighlights: ['Proforma Data Drop', 'Owner Reports', 'Comp Sets'],
    summaryTone: 'green',
    summaryIcon: 'spreadsheet',
    pageBadge: 'Finance tools',
    pageTitle: 'Choose your finance workflow.',
    pageDescription:
      'Open the finance workflow you need for data preparation, owner-facing reporting, or market benchmarking.',
    features: [
      {
        id: 'proforma-data-drop',
        title: 'Proforma Data Drop',
        description: 'Upload operator financial package and generate Proforma-ready dataset.',
        status: 'Active',
        tone: 'blue',
        icon: 'spreadsheet',
        highlights: [
          'Parse Public-format P&L tabs into vertical monthly rows.',
          'Apply COA mapping and surface unmapped accounts for review.',
          'Export clean Data Drop CSV without blocking unmapped rows.',
        ],
        href: '/finance/proforma-import',
      },
      {
        id: 'owner-reports',
        title: 'Owner Reports',
        description: 'Build owner report packages with STORE portfolio and market data.',
        status: 'Active',
        tone: 'green',
        icon: 'globe',
        highlights: [
          'Blend STORE portfolio results with market benchmarks',
          'Assemble owner decks with structured commentary sections',
          'Queue recurring owner report deliveries around asset manager cycles',
        ],
        href: '/owner-reports',
      },
      {
        id: 'comp-sets',
        title: 'Comp Sets',
        description: 'Benchmark STORE assets against competitor pricing.',
        status: 'Planned',
        tone: 'blue',
        icon: 'target',
        highlights: [
          'Import rate shops, rent rolls, and competitor snapshots',
          'Normalize premiums, concessions, and occupancy deltas',
          'Export comp set notes for underwriting decks',
        ],
        href: '/comp-sets',
      },
    ],
  },
  {
    key: 'other',
    href: '/other',
    title: 'Historical Data',
    summaryDescription: 'Historical dashboards, uploads, and access tools for reviewing property performance over time.',
    summaryHighlights: ['Historical Dashboard', 'Historical Data Upload', 'Dashboard Access'],
    summaryTone: 'amber',
    summaryIcon: 'layers',
    pageBadge: 'Historical tools',
    pageTitle: 'Choose a historical data workflow.',
    pageDescription:
      'Access the historical dashboard, upload new monthly data, and manage historical dashboard access links.',
    features: [
      {
        id: 'historical-data',
        title: 'Historical Data',
        description: 'Review facility history and performance drilldowns.',
        status: 'Active',
        tone: 'amber',
        icon: 'layers',
        highlights: [
          'Collections and AR aging trends with graphs',
          'Pricing quality, variance, and rent cadence',
          'Demand, autopay, and inventory drilldowns',
        ],
        href: '/historical-data',
      },
      {
        id: 'historical-data-upload',
        title: 'Historical Data Upload',
        description: 'Upload MSR and accounting files into the historical reporting pipeline.',
        status: 'Active',
        tone: 'blue',
        icon: 'spreadsheet',
        highlights: [
          'Preview parsed historical snapshots before saving them.',
          'Validate MSR, accounting, and monthly rollup inputs in one place.',
          'Push cleaned monthly history into the dashboard data store.',
        ],
        href: '/historical-data-upload',
      },
      {
        id: 'magic-dashboard-playground',
        title: 'Historical Dashboard Access',
        description: 'Create and inspect tokenized historical dashboard access links.',
        status: 'Active',
        tone: 'green',
        icon: 'globe',
        highlights: [
          'Generate share tokens by property with custom expiration windows.',
          'Pin dashboard links to a specific historical month.',
          'Review active tokens and Firebase snapshot coverage from one admin page.',
        ],
        href: '/admin/magic-dashboard-playground',
      },
    ],
  },
  {
    key: 'reporting',
    href: '/reporting',
    title: 'Reporting',
    summaryDescription: 'Recurring report generation and delivery workflows for STORE operational updates.',
    summaryHighlights: ['Daily Summary Report'],
    summaryTone: 'purple',
    summaryIcon: 'document',
    pageBadge: 'Reporting workflows',
    pageTitle: 'Choose a reporting workflow.',
    pageDescription:
      'Open the reporting workflow you need for daily report generation, review, and delivery.',
    features: [
      {
        id: 'daily-summary-report',
        title: 'Daily Summary Report',
        description: 'Automate daily flash reports for STORE properties.',
        status: 'Active',
        tone: 'purple',
        icon: 'document',
        highlights: [
          'Pull daily metrics from Tenant management summary exports',
          'Fill Excel flash templates with rentals, vacates, and occupancy',
          'Schedule automatic email delivery to property owners',
        ],
        href: '/daily-summary',
      },
    ],
  },
];

export function getWorkflowCategory(key: WorkflowCategoryKey): WorkflowCategory {
  const category = workflowCategories.find((entry) => entry.key === key);
  if (!category) {
    throw new Error(`Unknown workflow category: ${key}`);
  }
  return category;
}
