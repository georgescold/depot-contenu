import type { NextRequest } from "next/server";
import { UNASSIGNED } from "@/lib/assignee";
import { POSTS_PER_ACCOUNT } from "@/lib/stats-collect";
import { engagementRate } from "@/lib/stats-format";
import type { AccountStatsDay, PostStat } from "@/lib/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, fetchAll, handle, json } from "@/lib/api/http";
import { loadPeople, peopleMap, personJson, resolvePersonFilter } from "@/lib/api/people";
import { accountLabel, loadAccounts, loadFolderCtx, resolveAccountRef, resolveFolder } from "@/lib/api/resolve";
import { appOrigin } from "@/lib/api/serialize";
import {
  STATS_PLATFORM_LIST,
  accountAssignee,
  lastCollection,
  linkPostsToContents,
  parisDayOf,
  serializePost,
  totalsOf,
} from "@/lib/api/stats";
import { addDays, parseDate, parsePlatform, todayParis } from "@/lib/api/validate";

const SORTS = ["recent", "views", "likes", "engagement"] as const;
type Sort = (typeof SORTS)[number];
const PERIODS = ["7", "30", "90", "all"];

const desc = (a: number | null, b: number | null) => (b ?? -1) - (a ?? -1);

/**
 * GET /api/v1/stats?assignee=&folder=&account=&platform=&from=&to=&period=&sort=&limit=
 * Statistiques relevées chaque nuit (lecture seule) : totaux, comptes, posts.
 */
export async function GET(req: NextRequest) {
  return handle(req, async () => {
    const sp = req.nextUrl.searchParams;
    const today = todayParis();

    // Période : from/to explicites, sinon period=7|30|90|all (30 par défaut), sur le jour de publication (Paris).
    const period = sp.get("period")?.trim().toLowerCase() || undefined;
    if (period && !PERIODS.includes(period)) throw new ApiError(400, `« period » doit valoir ${PERIODS.join(", ")} (jours ; all = tout).`);
    let from: string | null = sp.get("from")?.trim() ? parseDate(sp.get("from"), "from") : null;
    let to: string | null = sp.get("to")?.trim() ? parseDate(sp.get("to"), "to") : null;
    if ((from || to) && period) throw new ApiError(400, "Choisis soit « period », soit « from » / « to ».");
    // null quand la période vient de from / to
    const effectivePeriod = from || to ? null : (period ?? "30");
    if (effectivePeriod && effectivePeriod !== "all") {
      from = addDays(today, -(Number(effectivePeriod) - 1)); // les N derniers jours, aujourd'hui compris
      to = today;
    }
    if (from && to && to < from) throw new ApiError(400, `« to » (${to}) doit être postérieur ou égal à « from » (${from}).`);

    const sort = (sp.get("sort")?.trim().toLowerCase() || "recent") as Sort;
    if (!SORTS.includes(sort)) throw new ApiError(400, `« sort » doit valoir ${SORTS.join(", ")}.`);
    const limitRaw = sp.get("limit");
    const limit = limitRaw ? Number(limitRaw) : 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new ApiError(400, "« limit » doit être un entier entre 1 et 200.");

    const sb = getAdminClient();
    const [ctx, accountList, peopleList] = await Promise.all([loadFolderCtx(sb), loadAccounts(sb), loadPeople(sb)]);
    const people = peopleMap(peopleList);
    const accounts = new Map(accountList.map((a) => [a.id, a]));

    // Comptes concernés
    let scope = accountList.filter((a) => (STATS_PLATFORM_LIST as readonly string[]).includes(a.platform));
    const folderRef = sp.get("folder")?.trim();
    if (folderRef) {
      const { folder } = await resolveFolder(sb, ctx, folderRef);
      const ids = ctx.subtree(folder.id);
      scope = scope.filter((a) => ids.has(a.folder_id));
    }
    const platformRef = sp.get("platform")?.trim();
    if (platformRef) {
      const p = parsePlatform(platformRef);
      if (!p) throw new ApiError(400, `Plateforme « ${platformRef} » inconnue.`);
      if (!(STATS_PLATFORM_LIST as readonly string[]).includes(p)) {
        throw new ApiError(400, `Pas de statistiques pour ${p} : seules ${STATS_PLATFORM_LIST.join(", ")} sont relevées.`);
      }
      scope = scope.filter((a) => a.platform === p);
    }
    const assigneeRef = sp.get("assignee")?.trim();
    const assigneeFilter = assigneeRef ? resolvePersonFilter(peopleList, assigneeRef) : undefined;
    if (assigneeFilter) {
      scope = scope.filter((a) => {
        const who = accountAssignee(ctx, people, a)?.id ?? null;
        return assigneeFilter === UNASSIGNED ? who === null : who === assigneeFilter;
      });
    }
    const accountRef = sp.get("account")?.trim();
    if (accountRef) {
      const platform = !accountRef.includes(":") && !accountRef.startsWith("@") ? parsePlatform(accountRef) : undefined;
      if (platform && scope.some((a) => a.platform === platform)) scope = scope.filter((a) => a.platform === platform);
      else {
        const acc = resolveAccountRef(ctx, scope.map((a) => ({ account: a, depth: 0 })), accountRef, "comptes suivis (statistiques)");
        scope = scope.filter((a) => a.id === acc.id);
      }
    }
    const scopeIds = new Set(scope.map((a) => a.id));

    // Posts et abonnés
    const [allPosts, days, collection] = await Promise.all([
      fetchAll<PostStat>((f, t) => sb.from("post_stats").select("*").order("id").range(f, t), "lecture des statistiques"),
      fetchAll<AccountStatsDay>(
        (f, t) => sb.from("account_stats_daily").select("*").gte("day", addDays(today, -120)).order("day").order("account_id").range(f, t),
        "lecture des abonnés",
      ),
      lastCollection(sb),
    ]);
    const inPeriod = (p: PostStat) => {
      if (!from && !to) return true;
      const d = parisDayOf(p.published_at);
      if (!d) return false;
      return (!from || d >= from) && (!to || d <= to);
    };
    const posts = allPosts.filter((p) => scopeIds.has(p.account_id) && inPeriod(p));

    const sorted = [...posts].sort((a, b) => {
      if (sort === "views") return desc(a.views, b.views);
      if (sort === "likes") return desc(a.likes, b.likes);
      if (sort === "engagement") return desc(engagementRate(a), engagementRate(b));
      return (b.published_at ?? "").localeCompare(a.published_at ?? "");
    });
    const shown = sorted.slice(0, limit);
    const links = await linkPostsToContents(sb, shown);
    const origin = appOrigin(req);

    const accountRows = scope
      .map((a) => {
        const mine = posts.filter((p) => p.account_id === a.id);
        const t = totalsOf(mine);
        const hist = days.filter((d) => d.account_id === a.id && d.followers !== null);
        const last = hist[hist.length - 1];
        const ref7 = last ? [...hist].reverse().find((d) => d.day <= addDays(last.day, -7)) : undefined;
        const collected = allPosts.filter((p) => p.account_id === a.id).reduce<string | null>((m, p) => (!m || p.updated_at > m ? p.updated_at : m), null);
        return {
          account: {
            id: a.id,
            ref: accountLabel(a),
            platform: a.platform,
            handle: a.handle,
            folder_path: ctx.path(a.folder_id),
            assignee: accountAssignee(ctx, people, a),
          },
          followers: last?.followers ?? null,
          followers_day: last?.day ?? null,
          followers_delta_7d: last && ref7 ? (last.followers ?? 0) - (ref7.followers ?? 0) : null,
          posts: t.posts,
          views: t.views,
          avg_views: t.views !== null && t.posts ? Math.round(t.views / mine.filter((p) => p.views !== null).length) : null,
          likes: t.likes,
          engagement: t.engagement,
          last_collected_at: collected ?? (last ? `${last.day}` : null),
        };
      })
      .sort((x, y) => desc(x.views, y.views) || x.account.ref.localeCompare(y.account.ref));

    return json({
      today,
      filters: {
        from,
        to,
        period: effectivePeriod,
        sort,
        limit,
        assignee: assigneeFilter ? (assigneeFilter === UNASSIGNED ? UNASSIGNED : personJson(people, assigneeFilter)) : null,
        folder: folderRef ?? null,
        account: accountRef ?? null,
        platform: platformRef ?? null,
      },
      totals: totalsOf(posts),
      accounts: accountRows,
      posts: shown.map((p) => serializePost(p, accounts.get(p.account_id), ctx, people, links.get(p.id), origin)),
      posts_total: posts.length,
      last_collection: collection,
      notes: [
        `Relevé chaque nuit vers minuit (heure de Paris), sur les ${POSTS_PER_ACCOUNT} derniers posts de chaque compte.`,
        "Instagram et YouTube ne donnent ni partages ni enregistrements (null).",
      ],
    });
  });
}
