import { format, isToday, isTomorrow, isYesterday, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

export function formatBytes(n: number): string {
  if (!n) return "0 o";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1).replace(".", ",")} ${units[i]}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** « Aujourd'hui », « Demain », « Lundi 20 octobre »… */
export function dayLabel(iso: string): string {
  const d = parseISO(iso);
  if (isToday(d)) return "Aujourd'hui";
  if (isTomorrow(d)) return "Demain";
  if (isYesterday(d)) return "Hier";
  return cap(format(d, "EEEE d MMMM", { locale: fr }));
}

export function longDate(iso: string): string {
  return cap(format(parseISO(iso), "EEEE d MMMM yyyy", { locale: fr }));
}

export function shortDate(iso: string): string {
  return format(parseISO(iso), "d MMM", { locale: fr });
}

export function monthLabel(d: Date): string {
  return cap(format(d, "MMMM yyyy", { locale: fr }));
}

export function formatTime(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : "";
}

export function dateTimeLabel(iso: string): string {
  return format(parseISO(iso), "d MMM yyyy 'à' HH:mm", { locale: fr });
}

/** Tri « naturel » : slide2 avant slide10 */
export const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" });
