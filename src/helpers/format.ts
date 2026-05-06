import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

export function formatDate(val: string | Date | null | undefined, fallback: string = "—"): string {
  if (!val) return fallback;
  if (typeof val === "string" && val === "Evergreen") return "Evergreen";
  const d = dayjs(val);
  return d.isValid() ? d.format("MM/DD/YYYY") : fallback;
}

export function formatDateTime(val: string | Date | null | undefined, fallback: string = "—"): string {
  if (!val) return fallback;
  const d = dayjs(val);
  return d.isValid() ? d.format("MM/DD/YYYY h:mm A") : fallback;
}

function hasExplicitTimezone(val: string): boolean {
  return /Z$|[+-]\d{2}:?\d{0,2}$/.test(val.trim());
}

export function formatDateTimeInZone(
  val: string | Date | null | undefined,
  tz: string | null | undefined,
  fallback: string = "—"
): string {
  if (!val) return fallback;
  const base =
    typeof val === "string" && !hasExplicitTimezone(val)
      ? dayjs.utc(val)
      : dayjs(val);
  if (!base.isValid()) return fallback;
  if (!tz) return base.local().format("MM/DD/YYYY h:mm A");
  try {
    return base.tz(tz).format("MM/DD/YYYY h:mm A");
  } catch {
    return base.local().format("MM/DD/YYYY h:mm A");
  }
}

export function formatLongDate(val: string | Date | null | undefined, fallback: string = "—"): string {
  if (!val) return fallback;
  const d = dayjs(val);
  return d.isValid() ? d.format("MMM D, YYYY") : fallback;
}

export function formatFullDate(val: string | Date | null | undefined, fallback: string = "—"): string {
  if (!val) return fallback;
  const d = dayjs(val);
  return d.isValid() ? d.format("MMMM D, YYYY") : fallback;
}

export function formatDateISO(val: string | Date | null | undefined): string {
  if (!val) return "";
  const d = dayjs(val);
  return d.isValid() ? d.format("YYYY-MM-DD") : "";
}

export function formatTime12h(timeVal: string): string {
  if (!timeVal) return "";
  const d = dayjs(`1970-01-01T${timeVal}`);
  return d.isValid() ? d.format("h:mm A") : timeVal;
}

export const formatUSD = (digit: number | string | null | undefined, decimals: number = 2): string => {
  const num = typeof digit === 'string' ? parseFloat(digit) : (digit ?? 0);
  const safe = isNaN(num as number) ? 0 : (num as number);
  return '$' + safe.toFixed(decimals).replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
};

export const currency_format = (digit: number | string | null | undefined, abbreviate: boolean = false, decimals: number = 2, defaultValue: any = '$0.00') => {
  if (digit === null || digit === undefined || digit === '') {
    return defaultValue;
  }
  const num = typeof digit === 'string' ? parseFloat(digit) : digit;
  if (isNaN(num) || num === 0) {
    return defaultValue;
  }

  if (abbreviate) {
    if (num >= 1000000) {
      return '$' + (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (num >= 1000) {
      return '$' + Math.round(num / 1000) + 'K';
    }
  }
  return '$' + num.toFixed(decimals).replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
};
