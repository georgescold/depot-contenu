import type { Publication } from "./types";

export type ContentStatus = "draft" | "scheduled" | "late" | "partial" | "posted";

export const STATUS_INFO: Record<ContentStatus, { label: string; tone: string }> = {
  draft: { label: "À planifier", tone: "neutral" },
  scheduled: { label: "Programmé", tone: "info" },
  late: { label: "En retard", tone: "danger" },
  partial: { label: "En cours", tone: "warning" },
  posted: { label: "Posté", tone: "success" },
};

/** Date du jour au format YYYY-MM-DD (heure locale). */
export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isLate(p: Pick<Publication, "posted" | "scheduled_date">, today = todayISO()) {
  return !p.posted && !!p.scheduled_date && p.scheduled_date < today;
}

export function contentStatus(
  pubs: Pick<Publication, "posted" | "scheduled_date">[],
  today = todayISO(),
): ContentStatus {
  if (pubs.length === 0) return "draft";
  const posted = pubs.filter((p) => p.posted).length;
  if (posted === pubs.length) return "posted";
  const pending = pubs.filter((p) => !p.posted);
  if (pending.some((p) => isLate(p, today))) return "late";
  if (pending.every((p) => !p.scheduled_date)) return posted > 0 ? "partial" : "draft";
  return posted > 0 ? "partial" : "scheduled";
}

/** Fichiers encore présents dans le stockage (hors archivés). */
export function liveAssets<T extends { archived_at: string | null }>(assets: T[]): T[] {
  return assets.filter((a) => !a.archived_at);
}
