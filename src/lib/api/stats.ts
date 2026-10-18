import type { SupabaseClient } from "@supabase/supabase-js";
import { effectiveAssignee } from "@/lib/assignee";
import { postIdFromUrl } from "@/lib/post-id";
import { engagementRate } from "@/lib/stats-format";
import type { Account, PostStat, Publication } from "@/lib/types";
import { dbFail } from "./errors";
import { chunk, fetchAll } from "./http";
import { effectiveJson, type PeopleMap } from "./people";
import { accountLabel, type FolderCtx } from "./resolve";
import { todayParis } from "./validate";

/** Plateformes dont l'app relève les statistiques chaque nuit. */
export const STATS_PLATFORM_LIST = ["tiktok", "instagram", "youtube"] as const;
export const CAPTION_MAX = 300;

/** Jour de publication à Paris (YYYY-MM-DD), ou null. */
export function parisDayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : todayParis(d);
}

/** Personne effective d'un compte : la sienne, sinon celle du dossier le plus proche. */
export function accountAssignee(ctx: FolderCtx, people: PeopleMap, a: Account) {
  return effectiveJson(people, effectiveAssignee(ctx.index, { folder_id: a.folder_id, assignee_id: null }, a));
}

export const metricsOf = (p: Pick<PostStat, "views" | "likes" | "comments" | "shares" | "saves">) => ({
  views: p.views,
  likes: p.likes,
  comments: p.comments,
  shares: p.shares,
  saves: p.saves,
  engagement: engagementRate(p),
});

/** Somme qui reste null si aucune valeur n'est connue (ex. partages sur Instagram). */
export function sumKnown(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null && v !== undefined);
  return known.length ? known.reduce((n, v) => n + v, 0) : null;
}

/** Totaux d'une liste de posts ; engagement = interactions / vues, sur les posts dont les vues sont connues. */
export function totalsOf(posts: PostStat[]) {
  const withViews = posts.filter((p) => p.views !== null);
  const views = sumKnown(posts.map((p) => p.views));
  const inter = withViews.reduce((n, p) => n + (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0), 0);
  return {
    posts: posts.length,
    views,
    likes: sumKnown(posts.map((p) => p.likes)),
    comments: sumKnown(posts.map((p) => p.comments)),
    shares: sumKnown(posts.map((p) => p.shares)),
    saves: sumKnown(posts.map((p) => p.saves)),
    engagement: views ? inter / views : null,
  };
}

export interface ContentLink {
  id: string;
  title: string;
  publication_id: string;
}

/**
 * Relie des posts aux contenus de l'app : par `publication_id` (posé à la collecte), sinon par l'identifiant
 * tiré du « lien du post » d'une publication du même compte (postIdFromUrl), comme l'interface.
 */
export async function linkPostsToContents(sb: SupabaseClient, posts: PostStat[]): Promise<Map<string, ContentLink>> {
  const out = new Map<string, ContentLink>();
  if (!posts.length) return out;
  const accountIds = [...new Set(posts.map((p) => p.account_id))];
  const pubs: Pick<Publication, "id" | "content_id" | "account_id" | "post_url">[] = [];
  for (const part of chunk(accountIds, 100)) {
    pubs.push(
      ...(await fetchAll<Pick<Publication, "id" | "content_id" | "account_id" | "post_url">>(
        (from, to) =>
          sb.from("publications").select("id, content_id, account_id, post_url").in("account_id", part).order("id").range(from, to),
        "lecture des publications",
      )),
    );
  }
  const byId = new Map(pubs.map((p) => [p.id, p]));
  const platformOf = new Map(posts.map((p) => [p.account_id, p.platform]));
  const byExternal = new Map<string, (typeof pubs)[number]>();
  for (const p of pubs) {
    const ext = postIdFromUrl(platformOf.get(p.account_id) ?? "", p.post_url);
    if (ext) byExternal.set(`${p.account_id}|${ext}`, p);
  }
  const matched = new Map<string, (typeof pubs)[number]>();
  for (const s of posts) {
    const pub = byExternal.get(`${s.account_id}|${s.external_id}`) ?? (s.publication_id ? byId.get(s.publication_id) : undefined);
    if (pub) matched.set(s.id, pub);
  }
  const contentIds = [...new Set([...matched.values()].map((p) => p.content_id))];
  const titles = new Map<string, string>();
  for (const part of chunk(contentIds, 100)) {
    const { data, error } = await sb.from("contents").select("id, title").in("id", part);
    if (error) throw dbFail(error, "lecture des contenus");
    for (const c of (data ?? []) as { id: string; title: string }[]) titles.set(c.id, c.title);
  }
  for (const [statId, pub] of matched) {
    if (titles.has(pub.content_id)) out.set(statId, { id: pub.content_id, title: titles.get(pub.content_id)!, publication_id: pub.id });
  }
  return out;
}

/** Un post tel que renvoyé par /stats et /stats/posts/:id. */
export function serializePost(
  p: PostStat,
  account: Account | undefined,
  ctx: FolderCtx,
  people: PeopleMap,
  link: ContentLink | undefined,
  origin: string,
) {
  const caption = p.caption ?? "";
  return {
    id: p.id,
    platform: p.platform,
    external_id: p.external_id,
    kind: p.kind,
    url: p.url,
    caption: caption.length > CAPTION_MAX ? caption.slice(0, CAPTION_MAX - 1) + "…" : caption,
    published_at: p.published_at,
    published_day: parisDayOf(p.published_at),
    thumbnail_url: p.thumbnail_url || null,
    ...metricsOf(p),
    updated_at: p.updated_at,
    account: account
      ? { id: account.id, ref: accountLabel(account), platform: account.platform, handle: account.handle, folder_path: ctx.path(account.folder_id) }
      : { id: p.account_id, ref: null, platform: p.platform, handle: null, folder_path: null },
    assignee: account ? accountAssignee(ctx, people, account) : null,
    content: link ? { id: link.id, title: link.title, publication_id: link.publication_id, url: `${origin}/contenus/${link.id}` } : null,
  };
}

/** Statistiques relevées d'une liste de publications (pour GET /contents/:id) : publication → post. */
export async function statsForPublications(
  sb: SupabaseClient,
  pubs: Pick<Publication, "id" | "account_id" | "post_url">[],
  accounts: Map<string, Account>,
) {
  const out = new Map<string, ReturnType<typeof statJson>>();
  if (!pubs.length) return out;
  const accountIds = [...new Set(pubs.map((p) => p.account_id))];
  const rows = await fetchAll<PostStat>(
    (from, to) =>
      sb
        .from("post_stats")
        .select("id, account_id, external_id, publication_id, url, views, likes, comments, shares, saves, updated_at")
        .in("account_id", accountIds)
        .order("id")
        .range(from, to) as never,
    "lecture des statistiques",
  );
  for (const pub of pubs) {
    const platform = accounts.get(pub.account_id)?.platform ?? "";
    const ext = postIdFromUrl(platform, pub.post_url);
    const hit =
      (ext ? rows.find((r) => r.account_id === pub.account_id && r.external_id === ext) : undefined) ??
      rows.find((r) => r.publication_id === pub.id);
    if (hit) out.set(pub.id, statJson(hit));
  }
  return out;
}

export function statJson(p: PostStat) {
  return { post_stat_id: p.id, url: p.url, ...metricsOf(p), updated_at: p.updated_at };
}

/** Dernière collecte enregistrée et prochaine prévue (cron Vercel « 0 23 * * * » UTC = vers minuit à Paris). */
export async function lastCollection(sb: SupabaseClient) {
  const { data, error } = await sb
    .from("apify_runs")
    .select("platform, status, ingested_at, started_at")
    .order("started_at", { ascending: false })
    .limit(30);
  if (error) throw dbFail(error, "lecture des collectes");
  const runs = (data ?? []) as { platform: string; status: string; ingested_at: string | null; started_at: string }[];
  const ingested = runs.filter((r) => r.status === "INGESTED" && r.ingested_at);
  const perPlatform = STATS_PLATFORM_LIST.map((platform) => {
    const r = runs.find((x) => x.platform === platform);
    return { platform, status: r?.status ?? null, at: r?.ingested_at ?? r?.started_at ?? null };
  });
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 0, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return {
    at: ingested[0]?.ingested_at ?? null,
    platforms: perPlatform,
    next_expected_at: next.toISOString(),
    next_label: "vers minuit (heure de Paris), chaque nuit",
  };
}
