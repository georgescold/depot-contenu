/** Formats des statistiques (français). */

const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("fr-FR");

/** 1 284 → « 1,3 k », 12 900 000 → « 12,9 M » ; null → « – ». */
export function compactNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "–";
  return n < 10_000 ? full.format(n) : compact.format(n);
}

export function fullNumber(n: number | null | undefined): string {
  return n === null || n === undefined ? "–" : full.format(n);
}

/** Variation signée : « +1,2 k », « −340 ». */
export function signedCompact(n: number): string {
  const s = compactNumber(Math.abs(n));
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : "0";
}

/** Taux d'engagement = (likes + commentaires + partages + enregistrements) / vues. */
export function engagementRate(p: { views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null }): number | null {
  if (!p.views) return null;
  const inter = (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0);
  return inter / p.views;
}

export function percent(r: number | null): string {
  if (r === null) return "–";
  return `${(r * 100).toLocaleString("fr-FR", { maximumFractionDigits: r < 0.1 ? 1 : 0 })} %`;
}
