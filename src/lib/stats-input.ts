import type { Account } from "./types";

/** Valeur à donner au scraper pour un compte (pseudo TikTok/Instagram, lien de chaîne YouTube), ou null. */
export function scraperInput(account: Pick<Account, "platform" | "handle" | "url">): string | null {
  const handle = account.handle.trim();
  const url = account.url.trim();
  switch (account.platform) {
    case "tiktok": {
      const m = url.match(/tiktok\.com\/@([A-Za-z0-9._]+)/);
      const h = m?.[1] ?? handle.replace(/^@/, "");
      return /^[A-Za-z0-9._]{2,}$/.test(h) ? h : null;
    }
    case "instagram": {
      const m = url.match(/instagram\.com\/([A-Za-z0-9._]+)/);
      const h = m?.[1] ?? handle.replace(/^@/, "");
      return /^[A-Za-z0-9._]{1,30}$/.test(h) && !["p", "reel", "reels", "tv"].includes(h) ? h : null;
    }
    case "youtube": {
      if (/youtube\.com\/(@|channel\/|c\/|user\/)/.test(url)) return url.replace(/[?#].*$/, "").replace(/\/(videos|shorts|featured|streams)\/?$/, "");
      const h = handle.replace(/^@/, "");
      return /^[A-Za-z0-9._-]{3,}$/.test(h) ? `https://www.youtube.com/@${h}` : null;
    }
    default:
      return null;
  }
}
