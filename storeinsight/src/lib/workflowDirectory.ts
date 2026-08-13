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

export type WorkflowCategoryKey = 'accounting' | 'finance' | 'other' | 'automations';

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
    summaryHighlights: ['Bank & Card Import Prep', 'FacilIQ Invoice Import Prep', 'Reconciliation review'],
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
        id: 'faciliq-invoice-import',
        title: 'FacilIQ Invoice Import Prep',
        description: 'Pick up the weekly FacilIQ invoice CSV from billing@ and split it per QuickBooks company.',
        status: 'Active',
        tone: 'green',
        icon: 'receipt',
        highlights: [
          'FacilIQ’s weekly export email is collected and converted on a schedule.',
          'Every row checked for invoice number, vendor, amount, date, property, and GL code.',
          'Separate import files for L001, P006, W002, and W003.',
          'Missing or questionable rows held back for review, never imported.',
        ],
        href: '/accounting/faciliq-invoice-import',
      },
      {
        id: 'quickbooks-connections',
        title: 'QuickBooks Connections',
        description: 'Connect each STORE property to its own QuickBooks company for bill creation.',
        status: 'Active',
        tone: 'blue',
        icon: 'bank',
        highlights: [
          'One QuickBooks company per property, never shared between them.',
          'A company whose name reads as a different property is refused.',
          'Bill creation stays off until it is explicitly enabled.',
        ],
        href: '/accounting/quickbooks',
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
    summaryDescription: 'Planning, owner reporting, and intake workflows for underwriting, operator data prep, and asset performance.',
    summaryHighlights: ['Proforma Data Drop', 'Owner Financials Extractor', 'Owner Reports'],
    summaryTone: 'green',
    summaryIcon: 'spreadsheet',
    pageBadge: 'Finance tools',
    pageTitle: 'Choose your finance workflow.',
    pageDescription:
      'Open the finance workflow you need for operator data preparation, owner-facing reporting, staging, and underwriting intake.',
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
        id: 'owner-financials-extractor',
        title: 'Owner Financials Extractor',
        description: 'Turn an owner financial workbook into a proforma-ready datapack.',
        status: 'Active',
        tone: 'green',
        icon: 'spreadsheet',
        highlights: [
          'Extra Space, Public Storage, and CubeSmart layouts each get their own extractor.',
          'Rolling IS unpivoted to one row per account per month, plus rent roll ECRI analytics.',
          'COA suggestions colour-coded by confidence with low-confidence accounts flagged.',
        ],
        href: '/finance/owner-financials-extractor',
      },
      {
        id: 'owner-reports',
        title: 'Owner Reports',
        description: 'Build owner report packages with STORE portfolio and market data.',
        status: 'Active',
        tone: 'green',
        icon: 'globe',
        highlights: [
          'Blend STORE portfolio results with market benchmarks.',
          'Assemble owner decks with structured commentary sections.',
          'Queue recurring owner report deliveries around asset manager cycles.',
        ],
        href: '/owner-reports',
      },
      {
        id: 'proforma-lakehouse',
        title: 'Proforma Lakehouse',
        description: 'Profile raw operator workbooks for P-Builder and stage them into SQL-backed intake.',
        status: 'Prototype',
        tone: 'green',
        icon: 'layers',
        highlights: [
          'Upload raw workbook families like Extra Space, Wentworth Results, and CubeSmart.',
          'Inspect detected sheets and section tags before building operator-specific parsers.',
          'Stage workbook metadata in Supabase so P-Builder can later pull normalized facts.',
        ],
        href: '/finance/proforma-lakehouse',
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
    key: 'automations',
    href: '/automations',
    title: 'Automations',
    summaryDescription: 'Recurring reports, scheduled deliveries, and automation monitoring tools for portfolio workflows.',
    summaryHighlights: ['Daily Summary Report', 'Property Analysis Package', 'Comp Sets'],
    summaryTone: 'purple',
    summaryIcon: 'clipboard',
    pageBadge: 'Automation tools',
    pageTitle: 'Choose an automation workflow.',
    pageDescription:
      'Open the automation workspace you need to manage scheduled reporting, monitor recurring jobs, or generate repeatable output packages.',
    features: [
      {
        id: 'daily-summary-report',
        title: 'Daily Summary Report',
        description: 'Manage daily flash reporting, delivery windows, and automation health.',
        status: 'Active',
        tone: 'purple',
        icon: 'document',
        highlights: [
          'Control recipient lists and send windows by property.',
          'Monitor nightly flash automation and recent MSR ingestion status.',
          'Generate manual Daily Flash PPTX output when needed.',
        ],
        href: '/daily-summary',
      },
      {
        id: 'property-analysis-package',
        title: 'Property Analysis Package',
        description: 'Generate templated PowerPoint packages directly from STORE proforma workbooks.',
        status: 'Active',
        tone: 'green',
        icon: 'globe',
        highlights: [
          'Upload a single STORE proforma workbook and parse package-ready values.',
          'Review extracted and manual token fields before export.',
          'Generate a PPTX from the managed PackageTemplate asset.',
        ],
        href: '/pptx-mail',
      },
      {
        id: 'deal-analysis',
        title: 'Deal Analysis',
        description: 'Upload broker financials and get an LLM recommendation on whether to pursue a deal.',
        status: 'Active',
        tone: 'amber',
        icon: 'target',
        highlights: [
          'Upload historical financials from storage operators or CRE brokers.',
          'Parse the workbook server-side and summarize the key metrics.',
          'Return an LLM recommendation on pursuing the property for STORE.',
        ],
        href: '/deal-analysis',
      },
      {
        id: 'lsa-automation',
        title: 'LSA Automation',
        description: 'Parse Google Ads / LSA statement PDFs into a consolidated activity spreadsheet.',
        status: 'Active',
        tone: 'purple',
        icon: 'receipt',
        highlights: [
          'Upload one or more LSA statement PDFs or a ZIP archive of them.',
          'Extract account name, statement range, and per-line charges and payments.',
          'Download a single workbook of new activity and payments received.',
        ],
        href: '/lsa-automation',
      },
      {
        id: 'exr-hummingbird',
        title: 'EXR to Hummingbird Tenant Transfer',
        description: 'Convert the standard Extra Space transfer bundle into the Hummingbird/Tenant import workbook.',
        status: 'Active',
        tone: 'green',
        icon: 'spreadsheet',
        highlights: [
          'Upload the required EXR site, unit, account, note, PCD, and disposition files.',
          'Build populated tenant, payment, promotion, final, and MIG import sheets.',
          'Validate unit counts, promo rows, prepaid tenants, and source-file warnings.',
        ],
        href: '/exr-hummingbird',
      },
      {
        id: 'occupancy-cleanup',
        title: 'Occupancy Stats Report Cleanup',
        description: 'Take the raw Occupancy Statistics Report from Tenant and get back a cleaned workbook with the Lender Unit Mix sheet ready to send.',
        status: 'Active',
        tone: 'blue',
        icon: 'spreadsheet',
        highlights: [
          'Drag and drop the raw XLSX from Tenant or Hummingbird.',
          'Aggregates Standard Storage and Parking unit mix from all SS and P sheets.',
          'Returns the original workbook with a new Lender Unit Mix sheet appended.',
        ],
        href: '/occupancy-cleanup',
      },
      {
        id: 'invoice-routing',
        title: 'Invoice Routing',
        description: 'Route approved FacilIQ invoices from billing@ to the right property inbox.',
        status: 'Prototype',
        tone: 'amber',
        icon: 'receipt',
        highlights: [
          'Parse approved FacilIQ invoices that land at billing@storestorage.com.',
          'Capture site, service date, GL code, work details, amount, and ticket number.',
          'Tag CapEx vs R&M by ticket prefix, then forward to the property inbox.',
        ],
        href: '/invoice-routing',
      },
      {
        id: 'comp-sets',
        title: 'Comp Sets',
        description: 'Benchmark STORE assets against competitor pricing.',
        status: 'Planned',
        tone: 'blue',
        icon: 'target',
        highlights: [
          'Import rate shops, rent rolls, and competitor snapshots.',
          'Normalize premiums, concessions, and occupancy deltas.',
          'Export comp set notes for underwriting decks.',
        ],
        href: '/comp-sets',
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
