/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * Header resolution for the weekly FacilIQ QuickBooks invoice export.
 *
 * The observed header (2026-07-28 to 2026-08-03 export) is:
 *   *InvoiceNo, *Customer, *InvoiceDate, *DueDate, Terms, Location, Memo,
 *   Item(Product/Service), ItemDescription, ItemQuantity, ItemRate, *ItemAmount,
 *   Service Date, PropertyName, GLCode
 *
 * Columns are matched by normalized alias rather than position, so a reordered or
 * renamed export is detected instead of silently mis-read. The resolved header for
 * each field is reported to the operator so the source mapping is never implied.
 */

export type FaciliqColumnKey =
  | 'invoiceNumber'
  | 'vendor'
  | 'invoiceDate'
  | 'dueDate'
  | 'terms'
  | 'location'
  | 'memo'
  | 'item'
  | 'description'
  | 'quantity'
  | 'rate'
  | 'amount'
  | 'serviceDate'
  | 'property'
  | 'glCode';

/** The six fields Alex requires on every invoice row before it may be imported. */
export const REQUIRED_COLUMN_KEYS = [
  'invoiceNumber',
  'vendor',
  'amount',
  'invoiceDate',
  'property',
  'glCode',
] as const;

export type RequiredColumnKey = (typeof REQUIRED_COLUMN_KEYS)[number];

export const COLUMN_LABELS: Record<FaciliqColumnKey, string> = {
  invoiceNumber: 'Invoice number',
  vendor: 'Vendor',
  invoiceDate: 'Invoice date',
  dueDate: 'Due date',
  terms: 'Terms',
  location: 'Location',
  memo: 'Memo',
  item: 'Item (product/service)',
  description: 'Item description',
  quantity: 'Quantity',
  rate: 'Rate',
  amount: 'Amount',
  serviceDate: 'Service date',
  property: 'Property',
  glCode: 'GL code',
};

/**
 * Aliases are normalized (lowercased, non-alphanumerics stripped) and tried in order,
 * so `*InvoiceNo` -> `invoiceno` and `Item(Product/Service)` -> `itemproductservice`.
 *
 * Vendor: FacilIQ carries the invoice party in `*Customer` (QuickBooks' own invoice
 * import column). A dedicated `Vendor` column is preferred if they ever add one.
 * Property: `location` is intentionally NOT an alias -- in the real export that column
 * holds the site street address, not the property code.
 */
const COLUMN_ALIASES: Record<FaciliqColumnKey, readonly string[]> = {
  invoiceNumber: ['invoiceno', 'invoicenumber', 'invoicenum', 'invoiceid', 'invoice', 'billno'],
  vendor: ['vendor', 'vendorname', 'supplier', 'payee', 'customer', 'customername'],
  invoiceDate: ['invoicedate', 'billdate', 'date'],
  dueDate: ['duedate'],
  terms: ['terms'],
  location: ['location'],
  memo: ['memo'],
  item: ['itemproductservice', 'productservice', 'item', 'itemname'],
  description: ['itemdescription', 'description', 'linedescription'],
  quantity: ['itemquantity', 'quantity', 'qty'],
  rate: ['itemrate', 'rate', 'unitprice', 'unitrate'],
  amount: ['itemamount', 'lineamount', 'linetotal', 'amount'],
  serviceDate: ['servicedate'],
  property: ['propertyname', 'property', 'propertycode', 'sitecode', 'site'],
  glCode: ['glcode', 'glaccount', 'glacct', 'accountcode', 'gl'],
};

/** Fixed resolution order: required fields claim their header before optional ones. */
const RESOLUTION_ORDER: readonly FaciliqColumnKey[] = [
  ...REQUIRED_COLUMN_KEYS,
  'dueDate',
  'serviceDate',
  'quantity',
  'rate',
  'item',
  'description',
  'memo',
  'terms',
  'location',
];

export const normalizeHeader = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

export type ColumnBinding = {
  key: FaciliqColumnKey;
  label: string;
  /** The header text exactly as it appears in the uploaded file. */
  header: string;
  index: number;
  required: boolean;
};

export type ResolvedColumns = {
  bindings: ColumnBinding[];
  indexByKey: Partial<Record<FaciliqColumnKey, number>>;
  /** Headers in the file that this workflow does not read. */
  unmappedHeaders: string[];
  missingRequired: RequiredColumnKey[];
};

export function resolveColumns(header: readonly string[]): ResolvedColumns {
  const normalized = header.map(normalizeHeader);
  const claimed = new Set<number>();
  const bindings: ColumnBinding[] = [];
  const indexByKey: Partial<Record<FaciliqColumnKey, number>> = {};

  for (const key of RESOLUTION_ORDER) {
    for (const alias of COLUMN_ALIASES[key]) {
      const index = normalized.findIndex((value, i) => value === alias && !claimed.has(i));
      if (index === -1) continue;
      claimed.add(index);
      indexByKey[key] = index;
      bindings.push({
        key,
        label: COLUMN_LABELS[key],
        header: header[index] ?? '',
        index,
        required: (REQUIRED_COLUMN_KEYS as readonly FaciliqColumnKey[]).includes(key),
      });
      break;
    }
  }

  const unmappedHeaders = header.filter(
    (value, index) => !claimed.has(index) && value.trim() !== '',
  );
  const missingRequired = REQUIRED_COLUMN_KEYS.filter((key) => indexByKey[key] === undefined);

  return { bindings, indexByKey, unmappedHeaders, missingRequired: [...missingRequired] };
}
