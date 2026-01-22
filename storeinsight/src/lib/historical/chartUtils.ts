export type ChartPoint = {
  x: number;
  y: number;
};

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatShortMonth(yyyyMm: string): string {
  const [, mm] = yyyyMm.split('-');
  const index = Number(mm) - 1;
  return MONTH_LABELS[index] ?? yyyyMm;
}

export function getChartPoints(
  values: number[],
  width: number,
  height: number,
  padding: number,
  minValue?: number,
  maxValue?: number,
): ChartPoint[] {
  if (!values.length) return [];
  const min = minValue ?? Math.min(...values);
  const max = maxValue ?? Math.max(...values);
  const range = max - min || 1;
  const step = values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0;

  return values.map((value, index) => {
    const x = padding + step * index;
    const y = padding + (1 - (value - min) / range) * (height - padding * 2);
    return { x, y };
  });
}

export function buildLinePath(points: ChartPoint[]): string {
  if (!points.length) return '';
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
}

export function buildAreaPath(points: ChartPoint[], height: number, padding: number): string {
  if (!points.length) return '';
  const baseY = height - padding;
  const line = buildLinePath(points);
  const start = points[0];
  const end = points[points.length - 1];
  return `${line} L ${end.x} ${baseY} L ${start.x} ${baseY} Z`;
}
