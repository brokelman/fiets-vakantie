const DUTCH_DAYS_SHORT = ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za'];
const DUTCH_MONTHS_SHORT = [
  'jan',
  'feb',
  'mrt',
  'apr',
  'mei',
  'jun',
  'jul',
  'aug',
  'sep',
  'okt',
  'nov',
  'dec',
];

export function isValidIsoDate(ymd?: string): boolean {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function addDaysToIsoDate(ymd: string, daysToAdd: number): string {
  if (!isValidIsoDate(ymd)) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + daysToAdd));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatIsoDateDutch(ymd?: string, includeYear = true): string {
  if (!ymd || !isValidIsoDate(ymd)) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayName = DUTCH_DAYS_SHORT[dt.getUTCDay()];
  const monthName = DUTCH_MONTHS_SHORT[dt.getUTCMonth()];
  return includeYear
    ? `${dayName} ${d} ${monthName} ${y}`
    : `${dayName} ${d} ${monthName}`;
}

/**
 * Formats a start date and optional end date into a readable Dutch period label.
 * Supports either a single date or a date range (tijdsreeks).
 */
export function formatDutchPeriodLabel(startDate?: string, endDate?: string): string {
  if (!startDate || !isValidIsoDate(startDate)) return '';
  const cleanEnd = endDate && isValidIsoDate(endDate) ? endDate : startDate;

  if (cleanEnd <= startDate) {
    return formatIsoDateDutch(startDate, true);
  }

  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = cleanEnd.split('-').map(Number);
  const startUtc = Date.UTC(sy, sm - 1, sd);
  const endUtc = Date.UTC(ey, em - 1, ed);
  const nights = Math.round((endUtc - startUtc) / (1000 * 60 * 60 * 24));

  const sameYear = sy === ey;
  const startStr = formatIsoDateDutch(startDate, !sameYear);
  const endStr = formatIsoDateDutch(cleanEnd, true).toLowerCase();
  const nightsSuffix =
    nights === 1 ? ' (1 nacht)' : nights > 1 ? ` (${nights} nachten)` : '';

  return `${startStr} t/m ${endStr}${nightsSuffix}`;
}

/**
 * Computes the date 1 week (7 days) after the vacation end date (or start date if single day).
 */
export function getReviewReminderDueDate(
  startDate?: string,
  endDate?: string
): string {
  const effectiveEnd =
    endDate && isValidIsoDate(endDate)
      ? endDate
      : startDate && isValidIsoDate(startDate)
      ? startDate
      : '';
  if (!effectiveEnd) return '';
  return addDaysToIsoDate(effectiveEnd, 7);
}

/**
 * Checks whether today is on or after 1 week (7 days) past the trip's end date.
 */
export function isReviewReminderDueNow(
  startDate?: string,
  endDate?: string,
  nowDate: Date = new Date()
): boolean {
  const dueYmd = getReviewReminderDueDate(startDate, endDate);
  if (!dueYmd) return false;
  const todayYmd = nowDate.toISOString().slice(0, 10);
  return todayYmd >= dueYmd;
}
