import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSET_KIND_LIST, MAX_FILE_MB, STORAGE_BUCKET } from "@/lib/constants";
import { ApiError } from "./errors";
import { chunk } from "./http";

export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

export function tooBigMessage(name: string, size: number): string {
  const mb = (size / 1024 / 1024).toFixed(1);
  return (
    `Fichier trop gros : « ${name} » fait ${mb} Mo, la limite est de ${MAX_FILE_MB} Mo par fichier ` +
    `(limite du plan gratuit Supabase). Compresse-le (ex. ffmpeg -crf 28, export 1080p) ou découpe-le avant de l'envoyer.`
  );
}

export interface ObjectInfo {
  size: number | null;
  contentType: string | null;
}

/** Infos d'un objet du bucket, ou null s'il n'existe pas. */
export async function objectInfo(sb: SupabaseClient, path: string): Promise<ObjectInfo | null> {
  const { data, error } = await sb.storage.from(STORAGE_BUCKET).info(path);
  if (error) {
    const status = error.status ?? Number(error.statusCode);
    if (status === 404 || status === 400 || /not.?found/i.test(error.message)) return null;
    throw new ApiError(502, `Stockage : impossible de vérifier « ${path} » (${error.message}).`);
  }
  if (!data) return null;
  const d = data as unknown as { size?: number; contentType?: string; metadata?: { size?: number; mimetype?: string } };
  return {
    size: d.size ?? d.metadata?.size ?? null,
    contentType: d.contentType ?? d.metadata?.mimetype ?? null,
  };
}

/** Supprime des objets du bucket (par paquets). */
export async function removeObjects(sb: SupabaseClient, paths: string[]): Promise<number> {
  const unique = [...new Set(paths.filter(Boolean))];
  let removed = 0;
  for (const part of chunk(unique, 100)) {
    const { data, error } = await sb.storage.from(STORAGE_BUCKET).remove(part);
    if (error) throw new ApiError(502, `Stockage : suppression impossible (${error.message}).`);
    removed += data?.length ?? 0;
  }
  return removed;
}

/** Tous les objets rangés sous <contentId>/<kind>/ (y compris ceux jamais enregistrés). */
export async function listContentObjects(sb: SupabaseClient, contentId: string): Promise<string[]> {
  const bucket = sb.storage.from(STORAGE_BUCKET);
  const out: string[] = [];
  for (const kind of ASSET_KIND_LIST) {
    const prefix = `${contentId}/${kind}`;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await bucket.list(prefix, { limit: 1000, offset });
      if (error) break;
      const files = (data ?? []).filter((o) => o.id); // les « dossiers » n'ont pas d'id
      out.push(...files.map((o) => `${prefix}/${o.name}`));
      if ((data ?? []).length < 1000) break;
    }
  }
  return out;
}
