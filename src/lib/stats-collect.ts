import type { SupabaseClient } from "@supabase/supabase-js";
import { getDatasetItems, getRun, startActorRun } from "./apify";
import { archiveConfirmedContents } from "./archive";
import { postIdFromUrl } from "./post-id";
import { matchPostsToPublications } from "./post-match";
import { scraperInput } from "./stats-input";
export { scraperInput };
import type { Account } from "./types";

/**
 * Collecte quotidienne des statistiques des comptes (TikTok, Instagram, YouTube) via Apify.
 * Un scraper par plateforme, pour tous les comptes d'un coup ; résultats lus par webhook (ou au passage suivant).
 */

export type StatsPlatform = "tiktok" | "instagram" | "youtube";
export const STATS_PLATFORMS: StatsPlatform[] = ["tiktok", "instagram", "youtube"];

/** Nombre de posts récents suivis par compte et par jour (le coût en dépend). */
export const POSTS_PER_ACCOUNT = 12;

const ACTORS: Record<StatsPlatform, { actor: string; usdPerItem: number; itemsPerAccount: number }> = {
  tiktok: { actor: "clockworks~tiktok-profile-scraper", usdPerItem: 0.003, itemsPerAccount: POSTS_PER_ACCOUNT },
  instagram: { actor: "apify~instagram-profile-scraper", usdPerItem: 0.0026, itemsPerAccount: 1 }, // 1 profil = ses 12 derniers posts
  youtube: { actor: "streamers~youtube-scraper", usdPerItem: 0.004, itemsPerAccount: POSTS_PER_ACCOUNT },
};

/** Date du jour à Paris (YYYY-MM-DD). */
export function parisDay(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(d);
}

function buildInput(platform: StatsPlatform, inputs: string[]) {
  switch (platform) {
    case "tiktok":
      return {
        profiles: inputs,
        profileScrapeSections: ["videos"],
        profileSorting: "latest",
        resultsPerPage: POSTS_PER_ACCOUNT,
        excludePinnedPosts: false,
      };
    case "instagram":
      return { usernames: inputs };
    case "youtube":
      return {
        startUrls: inputs.map((url) => ({ url })),
        maxResults: Math.ceil(POSTS_PER_ACCOUNT / 2),
        maxResultsShorts: Math.ceil(POSTS_PER_ACCOUNT / 2),
        maxResultStreams: 0,
      };
  }
}

export function webhookUrl(): string | undefined {
  const base =
    process.env.APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined);
  const secret = process.env.APIFY_WEBHOOK_SECRET;
  if (!base || !secret || base.includes("localhost")) return undefined;
  return `${base}/api/apify/webhook?secret=${encodeURIComponent(secret)}`;
}

/** Lance la collecte pour tous les comptes suivis. */
export async function startCollection(admin: SupabaseClient, trigger: "cron" | "manual") {
  const { data, error } = await admin.from("accounts").select("id, platform, handle, url").in("platform", STATS_PLATFORMS);
  if (error) throw error;
  const accounts = (data ?? []) as Pick<Account, "id" | "platform" | "handle" | "url">[];
  const results: { platform: StatsPlatform; accounts: number; skipped: string[]; runId?: string; tokenIndex?: number; error?: string }[] = [];

  for (const platform of STATS_PLATFORMS) {
    const mine = accounts.filter((a) => a.platform === platform);
    if (!mine.length) continue;
    const inputs: Record<string, string> = {};
    const skipped: string[] = [];
    for (const a of mine) {
      const v = scraperInput(a);
      if (v) inputs[platform === "youtube" ? v : v.toLowerCase()] = a.id;
      else skipped.push(a.handle || a.id);
    }
    const values = Object.keys(inputs);
    if (!values.length) {
      results.push({ platform, accounts: 0, skipped });
      continue;
    }
    const cfg = ACTORS[platform];
    const estimatedUsd = values.length * cfg.itemsPerAccount * cfg.usdPerItem;
    const started = await startActorRun(cfg.actor, buildInput(platform, values), { estimatedUsd, webhookUrl: webhookUrl() });
    if ("error" in started) {
      await admin.from("apify_runs").insert({
        platform,
        actor: cfg.actor,
        token_index: -1,
        inputs,
        status: "FAILED",
        trigger,
        error: started.error,
        finished_at: new Date().toISOString(),
      });
      results.push({ platform, accounts: values.length, skipped, error: started.error });
      continue;
    }
    await admin.from("apify_runs").insert({
      apify_run_id: started.run.id,
      platform,
      actor: cfg.actor,
      token_index: started.tokenIndex,
      inputs,
      status: started.run.status ?? "RUNNING",
      trigger,
    });
    results.push({ platform, accounts: values.length, skipped, runId: started.run.id, tokenIndex: started.tokenIndex });
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* Lecture des résultats                                               */
/* ------------------------------------------------------------------ */

interface PostRecord {
  account_id: string;
  platform: StatsPlatform;
  external_id: string;
  url: string;
  caption: string;
  kind: string;
  published_at: string | null;
  thumbnail_url: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

interface AccountRecord {
  account_id: string;
  followers: number | null;
  posts_count: number | null;
}

/** Légende gardée en entier (TikTok : 4 000 caractères max) : elle sert à repérer les contenus publiés. */
const CAPTION_MAX = 5000;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.slice(0, max) : "");
const iso = (v: unknown): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(typeof v === "number" ? v * 1000 : v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Transforme les résultats bruts d'un scraper en posts et en compteurs de comptes. */
export function parseItems(platform: StatsPlatform, items: Record<string, unknown>[], inputs: Record<string, string>) {
  const posts: PostRecord[] = [];
  const accounts = new Map<string, AccountRecord>();
  /** erreurs renvoyées par le scraper pour un compte (profil introuvable, privé…) */
  const errors = new Map<string, string>();
  const findAccount = (...candidates: unknown[]) => {
    for (const c of candidates) {
      if (typeof c !== "string" || !c) continue;
      const key = platform === "youtube" ? c : c.toLowerCase();
      if (inputs[key]) return inputs[key];
    }
    return null;
  };

  for (const it of items) {
    if (typeof it.error === "string" && it.error) {
      const accountId = findAccount(it.input, it.username, it.inputUrl, it.url);
      if (accountId) errors.set(accountId, friendlyScraperError(it.error));
      continue;
    }
    if (platform === "tiktok") {
      const meta = (it.authorMeta ?? {}) as Record<string, unknown>;
      const accountId = findAccount(it.input, meta.name);
      if (!accountId || !it.id) continue;
      accounts.set(accountId, { account_id: accountId, followers: num(meta.fans), posts_count: num(meta.video) });
      const video = (it.videoMeta ?? {}) as Record<string, unknown>;
      posts.push({
        account_id: accountId,
        platform,
        external_id: String(it.id),
        url: str(it.webVideoUrl, 300),
        caption: str(it.text, CAPTION_MAX),
        kind: it.isSlideshow ? "carousel" : "video",
        published_at: iso(it.createTimeISO) ?? iso(it.createTime),
        thumbnail_url: str(video.coverUrl, 1000),
        views: num(it.playCount),
        likes: num(it.diggCount),
        comments: num(it.commentCount),
        shares: num(it.shareCount),
        saves: num(it.collectCount),
      });
    } else if (platform === "instagram") {
      const accountId = findAccount(it.username, typeof it.inputUrl === "string" ? it.inputUrl.split("/").filter(Boolean).pop() : null);
      if (!accountId) continue;
      accounts.set(accountId, { account_id: accountId, followers: num(it.followersCount), posts_count: num(it.postsCount) });
      for (const p of (it.latestPosts ?? []) as Record<string, unknown>[]) {
        if (!p.shortCode) continue;
        const type = String(p.type ?? "");
        posts.push({
          account_id: accountId,
          platform,
          external_id: String(p.shortCode),
          url: str(p.url, 300) || `https://www.instagram.com/p/${p.shortCode}/`,
          caption: str(p.caption, CAPTION_MAX),
          kind: type === "Video" ? "reel" : type === "Sidecar" ? "carousel" : "photo",
          published_at: iso(p.timestamp),
          thumbnail_url: str(p.displayUrl, 1000),
          views: num(p.videoViewCount ?? p.videoPlayCount),
          likes: num(p.likesCount),
          comments: num(p.commentsCount),
          shares: null,
          saves: null,
        });
      }
    } else {
      const accountId = findAccount(it.input, it.inputChannelUrl);
      if (!accountId || !it.id) continue;
      accounts.set(accountId, { account_id: accountId, followers: num(it.numberOfSubscribers), posts_count: num(it.channelTotalVideos) });
      posts.push({
        account_id: accountId,
        platform,
        external_id: String(it.id),
        url: str(it.url, 300),
        caption: str(it.title),
        kind: it.type === "shorts" ? "short" : "video",
        published_at: iso(it.date),
        thumbnail_url: str(it.thumbnailUrl, 1000),
        views: num(it.viewCount),
        likes: num(it.likes),
        comments: num(it.commentsCount),
        shares: null,
        saves: null,
      });
    }
  }
  return { posts, accounts: [...accounts.values()], errors };
}

function friendlyScraperError(raw: string): string {
  if (/does not exist|not found|n'existe/i.test(raw)) return "Profil introuvable : vérifie le @pseudo (ou le compte n'est pas encore public).";
  if (/private/i.test(raw)) return "Compte privé : ses statistiques ne sont pas accessibles.";
  return raw.slice(0, 200);
}

/**
 * Récupère et enregistre les résultats d'une collecte. Ne fait rien si elle est encore en cours
 * ou déjà enregistrée. Les données partielles d'une collecte interrompue sont gardées.
 */
export async function ingestRun(admin: SupabaseClient, apifyRunId: string) {
  const { data: row } = await admin.from("apify_runs").select("*").eq("apify_run_id", apifyRunId).maybeSingle();
  if (!row) return { status: "unknown" as const };
  if (row.status === "INGESTED") return { status: "already" as const };

  const run = await getRun(row.token_index, apifyRunId);
  if (!run) return { status: "unknown" as const };
  if (run.status === "READY" || run.status === "RUNNING") return { status: "pending" as const };

  const platform = row.platform as StatsPlatform;
  const items = await getDatasetItems<Record<string, unknown>>(row.token_index, run.defaultDatasetId);
  const parsed = parseItems(platform, items, row.inputs ?? {});
  // un même post peut apparaître deux fois (post épinglé, profil demandé en double) : on garde le dernier
  const posts = [...new Map(parsed.posts.map((p) => [`${p.account_id}|${p.external_id}`, p])).values()];
  const accounts = parsed.accounts;

  // état de chaque compte demandé : erreur du scraper, rien reçu, ou OK
  const withData = new Set([...posts.map((p) => p.account_id), ...accounts.map((a) => a.account_id)]);
  const checkedAt = new Date().toISOString();
  for (const accountId of new Set(Object.values((row.inputs ?? {}) as Record<string, string>))) {
    // des données sont arrivées : les avertissements du scraper (ex. « pas de Shorts ») ne sont pas des erreurs
    const err = withData.has(accountId)
      ? null
      : (parsed.errors.get(accountId) ?? (run.status === "SUCCEEDED" ? "Aucun résultat : compte vide, privé ou introuvable." : null));
    await admin.from("accounts").update({ stats_error: err, stats_checked_at: checkedAt }).eq("id", accountId);
  }
  const day = parisDay();
  const now = new Date().toISOString();

  const accountIds = [...new Set(posts.map((p) => p.account_id))];
  const { pubByKey, contentOfPub, detected } = await linkPublications(admin, platform, accountIds, posts);

  let saved = 0;
  const linkedPubs = new Set<string>();
  for (let i = 0; i < posts.length; i += 200) {
    const chunk = posts.slice(i, i + 200).map((p) => ({
      ...p,
      publication_id: pubByKey.get(`${p.account_id}|${p.external_id}`) ?? null,
      updated_at: now,
    }));
    for (const c of chunk) if (c.publication_id) linkedPubs.add(c.publication_id);
    const { data: upserted, error } = await admin
      .from("post_stats")
      .upsert(chunk, { onConflict: "account_id,external_id" })
      .select("id, views, likes, comments, shares, saves");
    if (error) throw error;
    saved += upserted?.length ?? 0;
    const daily = (upserted ?? []).map((u) => ({
      post_stat_id: u.id,
      day,
      views: u.views,
      likes: u.likes,
      comments: u.comments,
      shares: u.shares,
      saves: u.saves,
    }));
    if (daily.length) {
      const { error: dErr } = await admin.from("post_stats_daily").upsert(daily, { onConflict: "post_stat_id,day" });
      if (dErr) throw dErr;
    }
  }
  if (accounts.length) {
    const { error: aErr } = await admin
      .from("account_stats_daily")
      .upsert(accounts.map((a) => ({ ...a, day })), { onConflict: "account_id,day" });
    if (aErr) throw aErr;
  }

  // contenus dont tous les posts sont maintenant retrouvés en ligne : fichiers retirés du stockage sans attendre
  const touched = [...new Set([...linkedPubs].map((id) => contentOfPub.get(id)).filter((id): id is string => !!id))];
  const archived = await archiveConfirmedContents(admin, touched).catch((e: unknown) => ({
    contents: 0,
    files: 0,
    freed_bytes: 0,
    errors: [e instanceof Error ? e.message : String(e)],
  }));

  await admin
    .from("apify_runs")
    .update({
      status: "INGESTED",
      items: items.length,
      posts: saved,
      cost_usd: run.usageTotalUsd === undefined ? null : Math.round(run.usageTotalUsd * 10000) / 10000,
      error: run.status === "SUCCEEDED" ? null : `${run.status}${run.statusMessage ? ` : ${run.statusMessage}` : ""}`,
      finished_at: run.finishedAt ?? now,
      ingested_at: now,
    })
    .eq("apify_run_id", apifyRunId);
  return { status: "ingested" as const, items: items.length, posts: saved, runStatus: run.status, detected, archived };
}

/** Heure de Paris d'un instant : date (YYYY-MM-DD) et heure (HH:MM:00), pour ranger le post au bon jour du planning. */
function parisDateTime(isoDate: string) {
  const d = new Date(isoDate);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return { date: parisDay(d), time: `${time}:00` };
}

/**
 * Relie les posts collectés aux publications de l'app : par l'identifiant contenu dans « Lien du post »,
 * sinon par le texte publié (repérage automatique). Une publication repérée est cochée « posté »
 * avec son lien, et rangée au jour et à l'heure réels de parution.
 */
async function linkPublications(admin: SupabaseClient, platform: StatsPlatform, accountIds: string[], posts: PostRecord[]) {
  const pubByKey = new Map<string, string>();
  const contentOfPub = new Map<string, string>();
  let detected = 0;
  if (!accountIds.length) return { pubByKey, contentOfPub, detected };

  const { data, error } = await admin
    .from("publications")
    .select("id, content_id, account_id, posted, post_url, title, description, contents(title)")
    .in("account_id", accountIds);
  if (error) throw error;
  type Row = {
    id: string;
    content_id: string;
    account_id: string;
    posted: boolean;
    post_url: string;
    title: string;
    description: string;
    contents: { title: string } | null;
  };
  const pubs = (data ?? []) as unknown as Row[];
  const unlinked: Row[] = [];
  for (const p of pubs) {
    contentOfPub.set(p.id, p.content_id);
    const id = postIdFromUrl(platform, p.post_url);
    if (id) pubByKey.set(`${p.account_id}|${id}`, p.id);
    else unlinked.push(p);
  }

  const postByKey = new Map(posts.map((p) => [`${p.account_id}|${p.external_id}`, p]));
  const free = [...postByKey].filter(([key, p]) => !pubByKey.has(key) && postIdFromUrl(platform, p.url));
  const matches = matchPostsToPublications(
    free.map(([key, p]) => ({ key, account_id: p.account_id, caption: p.caption })),
    unlinked.map((p) => ({
      id: p.id,
      account_id: p.account_id,
      platform,
      title: p.title,
      description: p.description,
      content_title: p.contents?.title ?? "",
    })),
  );

  for (const [pubId, key] of matches) {
    const pub = unlinked.find((p) => p.id === pubId)!;
    const post = postByKey.get(key)!;
    const patch: Record<string, unknown> = { post_url: post.url };
    if (!pub.posted) {
      patch.posted = true;
      patch.posted_at = post.published_at ?? new Date().toISOString();
      if (post.published_at) {
        const at = parisDateTime(post.published_at);
        patch.scheduled_date = at.date;
        patch.scheduled_time = at.time;
      }
    }
    // garde-fou : on ne touche pas une publication modifiée entre-temps dans l'app
    const { data: updated, error: uErr } = await admin
      .from("publications")
      .update(patch)
      .eq("id", pubId)
      .eq("posted", pub.posted)
      .eq("post_url", pub.post_url)
      .select("id");
    if (uErr) throw uErr;
    if (!updated?.length) continue;
    pubByKey.set(key, pubId);
    detected++;
  }
  return { pubByKey, contentOfPub, detected };
}

/** Rattrape les collectes terminées dont le webhook n'est pas arrivé. */
export async function ingestPendingRuns(admin: SupabaseClient) {
  const { data } = await admin
    .from("apify_runs")
    .select("apify_run_id")
    .not("apify_run_id", "is", null)
    .neq("status", "INGESTED")
    .gte("started_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());
  const out: Record<string, string> = {};
  for (const r of data ?? []) {
    try {
      out[r.apify_run_id as string] = (await ingestRun(admin, r.apify_run_id as string)).status;
    } catch (e) {
      out[r.apify_run_id as string] = `erreur : ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return out;
}
