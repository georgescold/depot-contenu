import type { Account } from "@/lib/types";
import { ApiError } from "./errors";
import { isObj, type Obj } from "./http";
import { accountLabel } from "./resolve";
import { nowParisHHMM, optBool, optDate, optText, optTime, todayParis } from "./validate";

/**
 * Avertissement si une publication non postée est programmée dans le passé (heure de Paris).
 * `null` si la date est à venir, absente, ou si la publication est déjà marquée postée.
 */
export function pastDateWarning(
  account: Account,
  p: { date?: string | null; time?: string | null; posted?: boolean | null },
): string | null {
  if (!p.date || p.posted) return null;
  const today = todayParis();
  const who = accountLabel(account);
  if (p.date < today) {
    return `${who} : la date ${p.date} est déjà passée (aujourd'hui : ${today}, heure de Paris). La publication apparaîtra « en retard ».`;
  }
  const now = nowParisHHMM();
  if (p.date === today && p.time && p.time.slice(0, 5) < now) {
    return `${who} : ${p.date} à ${p.time.slice(0, 5)} est déjà passé (il est ${now} à Paris).`;
  }
  return null;
}

/** Champs d'une publication tels qu'envoyés par le client (undefined = non fourni). */
export interface PubInput {
  account: unknown;
  date?: string | null;
  time?: string | null;
  title?: string;
  description?: string;
  posted?: boolean;
  post_url?: string;
}

export function parsePubInput(o: unknown, label = "publication"): PubInput {
  if (!isObj(o)) throw new ApiError(400, `Chaque ${label} doit être un objet { account, date?, time?, … }.`);
  const src: Obj = { ...o };
  // Alias tolérés
  if (src.date === undefined && src.scheduled_date !== undefined) src.date = src.scheduled_date;
  if (src.time === undefined && src.scheduled_time !== undefined) src.time = src.scheduled_time;
  if (src.description === undefined && src.caption !== undefined) src.description = src.caption;
  return {
    account: src.account ?? src.account_id,
    date: optDate(src, "date"),
    time: optTime(src, "time"),
    title: optText(src, "title", { max: 1000 }),
    description: optText(src, "description", { max: 70000, trim: false })?.replace(/\s+$/, ""),
    posted: optBool(src, "posted"),
    post_url: optText(src, "post_url", { max: 2000 }),
  };
}

/** Colonnes à écrire en base (seuls les champs fournis). */
export function pubColumns(p: PubInput): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (p.date !== undefined) {
    row.scheduled_date = p.date;
    // Déprogrammer efface aussi l'heure (sauf si une heure est fournie).
    if (p.date === null && p.time === undefined) row.scheduled_time = null;
  }
  if (p.time !== undefined) row.scheduled_time = p.time;
  if (p.title !== undefined) row.title = p.title;
  if (p.description !== undefined) row.description = p.description;
  if (p.posted !== undefined) row.posted = p.posted;
  if (p.post_url !== undefined) row.post_url = p.post_url;
  return row;
}

export function newPubRow(contentId: string, account: Account, p: PubInput): Record<string, unknown> {
  return {
    content_id: contentId,
    account_id: account.id,
    scheduled_date: null,
    scheduled_time: null,
    title: "",
    description: "",
    posted: false,
    post_url: "",
    ...pubColumns(p),
  };
}
