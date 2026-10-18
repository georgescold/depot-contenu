/**
 * Repérage automatique des posts publiés : parmi les posts relevés sur un compte par la collecte,
 * retrouve ceux qui correspondent à un contenu prévu dans l'app, d'après le texte publié
 * (légende TikTok / Instagram, titre YouTube). Volontairement prudent : en cas de doute, rien n'est relié
 * (la publication reste à cocher à la main, ou à relier en collant le lien du post).
 */

export interface MatchPost {
  key: string;
  account_id: string;
  caption: string;
}

export interface MatchPublication {
  id: string;
  account_id: string;
  platform: string;
  title: string;
  description: string;
  content_title: string;
}

/** Écart minimal avec le 2e meilleur candidat : sinon, c'est ambigu et on ne relie rien. */
const AMBIGUITY_MARGIN = 0.1;

const STOP = new Set(
  (
    "les des une pour que qui est pas avec sur dans par plus mais tes ton tous tout toute toutes ses son mes mon nos vos " +
    "aux ces cet cette elle ils elles vous nous leur leurs comme quand sont etre fait faire peut tres bien aussi meme " +
    "the and you your for with this that are from"
  ).split(" "),
);

/** Mots significatifs d'un texte (sans accents, sans liens, hashtags compris). */
export function words(text: string): Set<string> {
  const norm = text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ");
  return new Set(norm.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w)));
}

/**
 * Ressemblance de deux textes (0 à 1), ou 0 si elle ne suffit pas à conclure :
 * textes d'au moins 6 mots presque identiques (coefficient de Dice ≥ 0,75), ou textes courts aux mots identiques
 * (ex. un titre YouTube d'au moins 3 mots).
 */
export function textScore(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  const dice = (2 * shared) / (a.size + b.size);
  const smaller = Math.min(a.size, b.size);
  if (smaller >= 6 && dice >= 0.75) return dice;
  if (smaller >= 3 && shared === a.size && shared === b.size) return 1;
  return 0;
}

/** Texte prévu dans l'app pour une publication (titre pour YouTube, légende ailleurs). */
function plannedText(p: MatchPublication): string {
  if (p.platform === "youtube") return p.title.trim() || p.content_title;
  return p.description;
}

/**
 * Associe au plus un post à chaque publication (et inversement).
 * Retourne publication id → clé du post.
 */
export function matchPostsToPublications(posts: MatchPost[], pubs: MatchPublication[]): Map<string, string> {
  const pairs: { pub: string; post: string; score: number }[] = [];
  const postWords = new Map(posts.map((p) => [p.key, words(p.caption)]));
  for (const pub of pubs) {
    const planned = words(plannedText(pub));
    if (!planned.size) continue;
    for (const post of posts) {
      if (post.account_id !== pub.account_id) continue;
      const score = textScore(planned, postWords.get(post.key)!);
      if (score > 0) pairs.push({ pub: pub.id, post: post.key, score });
    }
  }

  pairs.sort((a, b) => b.score - a.score);
  const usedPubs = new Set<string>();
  const usedPosts = new Set<string>();
  const out = new Map<string, string>();
  for (const pair of pairs) {
    if (usedPubs.has(pair.pub) || usedPosts.has(pair.post)) continue;
    const rival = pairs.some(
      (o) => o !== pair && (o.pub === pair.pub || o.post === pair.post) && o.score >= pair.score - AMBIGUITY_MARGIN,
    );
    // ambigu (deux posts au même texte, ou deux fiches identiques) : on laisse les deux de côté
    usedPubs.add(pair.pub);
    usedPosts.add(pair.post);
    if (!rival) out.set(pair.pub, pair.post);
  }
  return out;
}
