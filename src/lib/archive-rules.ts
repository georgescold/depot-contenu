/**
 * Règles d'archivage après publication, partagées par le serveur et l'interface.
 * Un contenu posté sur tous ses comptes voit ses fichiers lourds retirés du stockage : tout de suite quand la collecte
 * de la nuit a retrouvé ses posts en ligne, sinon après un délai. On garde la fiche, les légendes, les dates,
 * la liste des fichiers et une petite image de couverture.
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

/** Plateformes dont la collecte de la nuit retrouve les posts en ligne (comme STATS_PLATFORMS côté serveur). */
export const ONLINE_CHECK_PLATFORMS = ["tiktok", "instagram", "youtube"];

/** Une publication vue par les règles d'archivage. */
export interface ArchiveRulePublication {
  posted: boolean;
  posted_at: string | null;
  platform: string;
  /** post retrouvé en ligne par la collecte (avec sa date de parution), absent sinon */
  online?: { published_at: string | null } | null;
}

/** Marge pour comparer la parution d'un post et la création de sa fiche. */
const CREATED_SLACK_MS = 3600 * 1000;

export function isFullyPosted(pubs: { posted: boolean }[]): boolean {
  return pubs.length > 0 && pubs.every((p) => p.posted);
}

/**
 * Fichiers à retirer sans attendre : posté partout, chaque post TikTok / Instagram / YouTube retrouvé en ligne,
 * et paru après la création de la fiche. Un contenu ajouté alors qu'il était déjà en ligne garde le délai habituel,
 * compté depuis son ajout (le temps de vérifier qu'il ne doit pas être reposté).
 */
export function isConfirmedOnline(contentCreatedAt: string, pubs: ArchiveRulePublication[]): boolean {
  const tracked = pubs.filter((p) => ONLINE_CHECK_PLATFORMS.includes(p.platform));
  const created = Date.parse(contentCreatedAt) || 0;
  return (
    isFullyPosted(pubs) &&
    tracked.length > 0 &&
    tracked.every((p) => p.online?.published_at && Date.parse(p.online.published_at) >= created - CREATED_SLACK_MS)
  );
}

/** Départ du délai d'archivage (ms) : dernière publication cochée, et au plus tôt l'ajout de la fiche. */
export function archiveDelayStart(contentCreatedAt: string, pubs: { posted_at: string | null }[]): number {
  return Math.max(lastPostedAt(pubs), Date.parse(contentCreatedAt) || 0);
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
