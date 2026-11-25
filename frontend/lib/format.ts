import { getLang, locale, tr } from "./i18n";

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function todayISO(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

export function shiftISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function dateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (getLang() === "en") return `${MONTH_EN[m - 1]} ${d} (${WEEKDAY_EN[w]})`;
  return `${m}월 ${d}일 (${WEEKDAY[w]})`;
}

export function relDay(iso: string): string | null {
  const t = todayISO();
  if (iso === t) return tr("오늘");
  if (iso === shiftISO(t, -1)) return tr("어제");
  return null;
}

export function num(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  return n.toLocaleString(locale(), { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
