import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ARCHIVE_DELAY_CHOICES,
  DEFAULT_ARCHIVE_DELAY,
  KEEP_COVER_MAX_BYTES,
  filesToArchive,
  isFullyPosted,
  lastPostedAt,
  type ArchivableAssetLike,
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
  publications: { posted: boolean; posted_at: string | null }[];
  assets: ArchivableAsset[];
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
  "id, keep_files, publications(posted, posted_at), assets(id, kind, position, storage_path, size_bytes, archived_at)";

/** Passage automatique (cron quotidien) : archive les contenus postés depuis plus que le délai réglé. */
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
    for (const c of (data ?? []) as ArchivableContent[]) {
      if (!isFullyPosted(c.publications) || lastPostedAt(c.publications) > cutoff) continue;
      if (!filesToArchive(c.assets).length) continue;
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
