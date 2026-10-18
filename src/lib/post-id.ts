import type { Platform } from "./types";

/**
 * Identifiant d'un post à partir de son lien (pour relier une publication de l'app aux statistiques collectées).
 * TikTok : id numérique de /video/… ; Instagram : shortCode de /p/, /reel/, /reels/, /tv/ ; YouTube : id de la vidéo.
 */
export function postIdFromUrl(platform: Platform | string, url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  let m: RegExpMatchArray | null = null;
  switch (platform) {
    case "tiktok":
      m = u.match(/\/(?:video|photo)\/(\d{6,})/);
      break;
    case "instagram":
      m = u.match(/instagram\.com\/(?:[^/?#]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
      break;
    case "youtube":
      m =
        u.match(/[?&]v=([A-Za-z0-9_-]{6,})/) ??
        u.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/) ??
        u.match(/\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{6,})/);
      break;
  }
  return m ? m[1] : null;
}
