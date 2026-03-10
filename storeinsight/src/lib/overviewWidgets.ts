export type OverviewWidgetKey =
  | 'occupancy'
  | 'netRevenue'
  | 'expenses'
  | 'noi'
  | 'pastDue'
  | 'rateVariance'
  | 'conversionRate'
  | 'leads'
  | 'promosDiscounts'
  | 'autopay'
  | 'tppEnrollment'
  | 'moveIns'
  | 'moveOuts'
  | 'netRentals'
  | 'staleRent';

export const OVERVIEW_WIDGET_OPTIONS: Array<{
  id: OverviewWidgetKey;
  label: string;
  description: string;
}> = [
  { id: 'occupancy', label: 'Occupancy', description: 'RSF occupancy trend from saved snapshots.' },
  { id: 'netRevenue', label: 'Net Revenue', description: 'Monthly net revenue trend from the MSR.' },
  { id: 'expenses', label: 'Expenses', description: 'Operating expense trend from stored financials.' },
  { id: 'noi', label: 'NOI', description: 'Net operating income trend for owner performance.' },
  { id: 'pastDue', label: 'Past Due', description: 'Total delinquent AR trend across months.' },
  { id: 'rateVariance', label: 'Rate Variance', description: 'Occupied rate variance trend versus current rates.' },
  { id: 'conversionRate', label: 'Conversion Rate', description: 'Move-ins as a percentage of leads.' },
  { id: 'leads', label: 'Leads', description: 'Total lead volume trend by month.' },
  { id: 'promosDiscounts', label: 'Promos', description: 'Discount and promotion leakage trend.' },
  { id: 'autopay', label: 'Autopay', description: 'Autopay adoption trend for the property.' },
  { id: 'tppEnrollment', label: 'TPP Enrollment', description: 'Insurance/TPP enrollment trend over time.' },
  { id: 'moveIns', label: 'Move-ins', description: 'Monthly move-in activity trend.' },
  { id: 'moveOuts', label: 'Move-outs', description: 'Monthly move-out activity trend.' },
  { id: 'netRentals', label: 'Net Rentals', description: 'Move-ins minus move-outs by month.' },
  { id: 'staleRent', label: 'Stale Rent', description: 'Units with no rent change in the last 12 months.' },
];

export const DEFAULT_OVERVIEW_WIDGETS: OverviewWidgetKey[] = ['expenses', 'noi'];

export function filterOverviewWidgets(input: unknown): OverviewWidgetKey[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set<OverviewWidgetKey>(OVERVIEW_WIDGET_OPTIONS.map((option) => option.id));
  const next: OverviewWidgetKey[] = [];

  for (const value of input) {
    if (typeof value !== 'string') continue;
    if (!allowed.has(value as OverviewWidgetKey)) continue;
    const widget = value as OverviewWidgetKey;
    if (!next.includes(widget)) {
      next.push(widget);
    }
  }

  return next;
}

export function getOverviewWidgetsOrDefault(input: unknown): OverviewWidgetKey[] {
  const widgets = filterOverviewWidgets(input);
  return widgets.length ? widgets : [...DEFAULT_OVERVIEW_WIDGETS];
}
