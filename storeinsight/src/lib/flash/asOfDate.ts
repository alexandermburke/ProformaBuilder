const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function shiftDateByDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function formatUsDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

export function formatFlashAsOfDate(date: Date): string {
  return formatUsDate(shiftDateByDays(date, -1));
}

export function formatFlashAsOfDateFromIsoDate(value: string): string {
  if (!ISO_DATE_PATTERN.test(value)) return value;
  const [year, month, day] = value.split("-").map(Number);
  return formatFlashAsOfDate(new Date(year, month - 1, day));
}
