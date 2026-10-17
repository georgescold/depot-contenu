import { deleteObjects, headObject, listObjects, type ObjectInfo } from "@/lib/b2";
import { MAX_FILE_MB } from "@/lib/constants";
import { ApiError } from "./errors";

export type { ObjectInfo };

export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

export function tooBigMessage(name: string, size: number): string {
  const mb = (size / 1024 / 1024).toFixed(1);
  return (
    `Fichier trop gros : « ${name} » fait ${mb} Mo, la limite est de ${MAX_FILE_MB} Mo par fichier. ` +
    `Compresse-le (ex. ffmpeg -crf 28, export 1080p) ou découpe-le avant de l'envoyer.`
  );
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Infos d'un objet du stockage (Backblaze B2), ou null s'il n'existe pas. */
export async function objectInfo(path: string): Promise<ObjectInfo | null> {
  try {
    return await headObject(path);
  } catch (e) {
    throw new ApiError(502, `Stockage : impossible de vérifier « ${path} » (${reason(e)}).`);
  }
}

/** Supprime des objets du stockage (erreur 502 si le stockage refuse). */
export async function removeObjects(paths: string[]): Promise<number> {
  try {
    return await deleteObjects(paths);
  } catch (e) {
    throw new ApiError(502, `Stockage : suppression impossible (${reason(e)}).`);
  }
}

export interface PurgeResult {
  removed: number;
  warnings: string[];
}

/**
 * Suppression « au mieux », après celle de la ligne en base : ne lève jamais,
 * renvoie des avertissements (les restes seront ramassés par le nettoyage quotidien).
 * Avec `prefixOf`, purge aussi tout ce qui reste sous `<contentId>/` (envois interrompus).
 */
export async function purgeObjects(paths: string[], prefixOf?: string): Promise<PurgeResult> {
  const warnings: string[] = [];
  const all = [...paths];
  if (prefixOf) {
    try {
      all.push(...(await listObjects(`${prefixOf}/`)));
    } catch (e) {
      warnings.push(`Stockage : liste des fichiers de ${prefixOf}/ impossible (${reason(e)}) ; d'éventuels restes seront supprimés par le nettoyage quotidien.`);
    }
  }
  if (!all.length) return { removed: 0, warnings };
  try {
    return { removed: await deleteObjects(all), warnings };
  } catch (e) {
    warnings.push(`Stockage : suppression des fichiers impossible (${reason(e)}) ; ils seront supprimés par le nettoyage quotidien.`);
    return { removed: 0, warnings };
  }
}
