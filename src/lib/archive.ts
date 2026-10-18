import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ARCHIVE_DELAY_CHOICES,
  DEFAULT_ARCHIVE_DELAY,
  KEEP_COVER_MAX_BYTES,
  archiveDelayStart,
  filesToArchive,
  isConfirmedOnline,
  isFullyPosted,
  lastPostedAt,
  type ArchivableAssetLike,
  type ArchiveRulePublication,
} from "./archive-rules";
import { deleteObjects } from "./b2";

/** Archivage après publication, côté serveur (règles communes dans archive-rules.ts). */

export { ARCHIVE_DELAY_CHOICES, DEFAULT_ARCHIVE_DELAY, KEEP_COVER_MAX_BYTES, filesToArchive, isFullyPosted, lastPostedAt };

export interface ArchivableAsset extends ArchivableAssetLike {
  storage_path: string;
}

export interface ArchivableContent {
  id: string;
  keep_files: boolean;
  created_at: string;
  publications: {
    posted: boolean;
    posted_at: string | null;
    account: { platform: string } | null;
    /** post retrouvé en ligne par la collecte (au plus un par publication) */
    post_stats: { published_at: string | null }[];
  }[];
  assets: ArchivableAsset[];
}

function rulePublications(c: ArchivableContent): ArchiveRulePublication[] {
  return c.publications.map((p) => ({
    posted: p.posted,
    posted_at: p.posted_at,
    platform: p.account?.platform ?? "",
    online: p.post_stats?.[0] ?? null,
  }));
}

/** Délai réglé (en jours) ; null = jamais. */
export async function getArchiveDelay(admin: SupabaseClient): Promise<number | null> {
  const { data, error } = await admin.from("app_settings").select("value").eq("key", "archive_after_days").maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_ARCHIVE_DELAY;
  return typeof data.value === "number" ? data.value : null;
}

export async function setArchiveDelay(admin: SupabaseClient, days: number | null): Promise<void> {
  const { error } = await admin
    .from("app_settings")
    // la colonne jsonb n'accepte pas NULL : « jamais » est enregistré comme la chaîne "never"
    .upsert({ key: "archive_after_days", value: days === null ? "never" : days }, { onConflict: "key" });
  if (error) throw error;
}

/**
 * Supprime du stockage les fichiers lourds d'un contenu puis les marque archivés.
 * Si le stockage refuse, rien n'est marqué (nouvel essai au prochain passage).
 */
export async function archiveContentFiles(
  admin: SupabaseClient,
  content: ArchivableContent,
): Promise<{ archivedIds: string[]; freedBytes: number; archivedAt: string | null }> {
  const targets = filesToArchive(content.assets);
  if (!targets.length) return { archivedIds: [], freedBytes: 0, archivedAt: null };
  await deleteObjects(targets.map((a) => a.storage_path));
  const archivedAt = new Date().toISOString();
  const ids = targets.map((a) => a.id);
  const { error } = await admin.from("assets").update({ archived_at: archivedAt }).in("id", ids);
  if (error) throw error;
  const { error: cErr } = await admin.from("contents").update({ files_archived_at: archivedAt }).eq("id", content.id);
  if (cErr) throw cErr;
  return { archivedIds: ids, freedBytes: targets.reduce((n, a) => n + (a.size_bytes || 0), 0), archivedAt };
}

export const ARCHIVE_SELECT =
  "id, keep_files, created_at, publications(posted, posted_at, account:accounts!publications_account_id_fkey(platform), post_stats(published_at)), assets(id, kind, position, storage_path, size_bytes, archived_at)";

/**
 * Juste après une collecte : retire tout de suite les fichiers des contenus dont tous les posts ont été retrouvés en ligne
 * (sauf « Garder les fichiers » ou archivage désactivé dans les réglages).
 */
export async function archiveConfirmedContents(admin: SupabaseClient, contentIds: string[]) {
  const res = { contents: 0, files: 0, freed_bytes: 0, errors: [] as string[] };
  if (!contentIds.length || (await getArchiveDelay(admin)) === null) return res;
  for (let i = 0; i < contentIds.length; i += 100) {
    const { data, error } = await admin
      .from("contents")
      .select(ARCHIVE_SELECT)
      .in("id", contentIds.slice(i, i + 100))
      .eq("keep_files", false);
    if (error) throw error;
    for (const c of (data ?? []) as unknown as ArchivableContent[]) {
      if (!filesToArchive(c.assets).length || !isConfirmedOnline(c.created_at, rulePublications(c))) continue;
      try {
        const done = await archiveContentFiles(admin, c);
        res.contents++;
        res.files += done.archivedIds.length;
        res.freed_bytes += done.freedBytes;
      } catch (e) {
        res.errors.push(`${c.id} : ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return res;
}

/**
 * Passage automatique (cron quotidien) : archive les contenus postés partout dont les posts ont été retrouvés en ligne,
 * et les autres une fois le délai réglé écoulé.
 */
export async function runAutoArchive(admin: SupabaseClient) {
  const days = await getArchiveDelay(admin);
  if (days === null) return { enabled: false, contents: 0, files: 0, freed_bytes: 0, errors: [] as string[] };
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  let contents = 0;
  let files = 0;
  let freed = 0;
  const errors: string[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await admin
      .from("contents")
      .select(ARCHIVE_SELECT)
      .eq("keep_files", false)
      .order("id")
      .range(from, from + 499);
    if (error) throw error;
    for (const c of (data ?? []) as unknown as ArchivableContent[]) {
      const pubs = rulePublications(c);
      if (!isFullyPosted(pubs) || !filesToArchive(c.assets).length) continue;
      if (!isConfirmedOnline(c.created_at, pubs) && archiveDelayStart(c.created_at, pubs) > cutoff) continue;
      try {
        const res = await archiveContentFiles(admin, c);
        contents++;
        files += res.archivedIds.length;
        freed += res.freedBytes;
      } catch (e) {
        errors.push(`${c.id} : ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!data || data.length < 500) break;
  }
  return { enabled: true, delay_days: days, contents, files, freed_bytes: freed, errors };
}
