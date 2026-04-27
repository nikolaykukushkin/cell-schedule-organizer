/** Format a Date to YYYY-MM-DD string */
export function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

/** Parse YYYY-MM-DD to Date (local timezone) */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Get all dates in a month grid (includes leading/trailing days to fill weeks) */
export function getMonthGrid(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Start from Monday of the week containing the 1st
  const startDow = (firstDay.getDay() + 6) % 7; // 0=Mon
  const gridStart = new Date(year, month, 1 - startDow);

  // End on Sunday of the week containing the last day
  const endDow = (lastDay.getDay() + 6) % 7;
  const gridEnd = new Date(year, month + 1, 0 + (6 - endDow));

  const dates: Date[] = [];
  const current = new Date(gridStart);
  while (current <= gridEnd) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/** Number of days between two date strings (inclusive) */
export function daySpan(start: string, end: string): number {
  const s = parseDate(start);
  const e = parseDate(end);
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
}

/** Signed day-delta from a → b. Positive when b is later. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86400000);
}

/** Build a contiguous list of N dates starting at originStr. */
export function timelineRange(originStr: string, dayCount: number): Date[] {
  const out: Date[] = [];
  const o = parseDate(originStr);
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(o);
    d.setDate(o.getDate() + i);
    out.push(d);
  }
  return out;
}

/** Add days to a date string */
export function addDays(dateStr: string, days: number): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

/** Check if a date string falls within a range (inclusive) */
export function isInRange(dateStr: string, start: string, end: string): boolean {
  return dateStr >= start && dateStr <= end;
}

/** Check if two date ranges overlap */
export function rangesOverlap(s1: string, e1: string, s2: string, e2: string): boolean {
  return s1 <= e2 && s2 <= e1;
}

/** Shift a (date, hour) pair by deltaHours, rolling across day boundaries. */
export function shiftDateHour(date: string, hour: number, deltaHours: number): { date: string; hour: number } {
  let total = hour + deltaHours;
  let dayShift = 0;
  while (total >= 24) { total -= 24; dayShift++; }
  while (total < 0) { total += 24; dayShift--; }
  return { date: addDays(date, dayShift), hour: total };
}
