/**
 * Règles d'archivage après publication, partagées par le serveur et l'interface.
 * Un contenu posté sur tous ses comptes voit ses fichiers lourds retirés du stockage après un délai ;
 * on garde la fiche, les légendes, les dates, la liste des fichiers et une petite image de couverture.
 */

/** Une miniature (ou 1re slide) jusqu'à cette taille reste stockée, pour reconnaître le contenu dans l'historique. */
export const KEEP_COVER_MAX_BYTES = 2 * 1024 * 1024;
export const ARCHIVE_DELAY_CHOICES = [0, 1, 3, 7, 30] as const;
export const DEFAULT_ARCHIVE_DELAY = 3;

export interface ArchivableAssetLike {
  id: string;
  kind: string;
  position: number;
  size_bytes: number;
  archived_at: string | null;
}

export function isFullyPosted(pubs: { posted: boolean }[]): boolean {
  return pubs.length > 0 && pubs.every((p) => p.posted);
}

/** Horodatage de la dernière publication (ms), ou 0. */
export function lastPostedAt(pubs: { posted_at: string | null }[]): number {
  return pubs.reduce((max, p) => Math.max(max, p.posted_at ? Date.parse(p.posted_at) : 0), 0);
}

/** Fichiers à retirer : tout ce qui est encore stocké, sauf une petite image de couverture. */
export function filesToArchive<T extends ArchivableAssetLike>(assets: T[]): T[] {
  const live = assets.filter((a) => !a.archived_at).sort((a, b) => a.position - b.position);
  const cover = live.find((a) => a.kind === "thumbnail") ?? live.find((a) => a.kind === "photo");
  const keepId = cover && cover.size_bytes <= KEEP_COVER_MAX_BYTES ? cover.id : null;
  return live.filter((a) => a.id !== keepId);
}

export function archiveDelayLabel(days: number | null): string {
  if (days === null) return "jamais (fichiers gardés)";
  if (days === 0) return "dès la nuit suivante";
  if (days === 1) return "1 jour après";
  return `${days} jours après`;
}
