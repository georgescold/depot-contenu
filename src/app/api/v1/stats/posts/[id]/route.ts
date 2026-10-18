import type { NextRequest } from "next/server";
import { postIdFromUrl } from "@/lib/post-id";
import type { PostStat } from "@/lib/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, dbFail, handle, json } from "@/lib/api/http";
import { loadPeople, peopleMap } from "@/lib/api/people";
import { decodeRefParam, loadAccounts, loadFolderCtx } from "@/lib/api/resolve";
import { appOrigin } from "@/lib/api/serialize";
import { STATS_PLATFORM_LIST, lastCollection, linkPostsToContents, metricsOf, serializePost } from "@/lib/api/stats";
import { isUuid } from "@/lib/api/validate";

// Type explicite (équivalent de RouteContext<"/api/v1/stats/posts/[id]">) : indépendant des types du dernier build.
type Ctx = { params: Promise<{ id: string }> };

/** Plateforme d'après le domaine du lien. */
function platformOfUrl(url: string): string | null {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (/(^|\.)tiktok\.com$/.test(host)) return "tiktok";
  if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return "youtube";
  return null;
}

/**
 * GET /api/v1/stats/posts/:id : un post relevé et son historique jour par jour.
 * `:id` = id de la ligne post_stats, ou lien du post encodé (TikTok, Instagram, YouTube).
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(req, async () => {
    const ref = decodeRefParam((await ctx.params).id).trim();
    const sb = getAdminClient();
    let post: PostStat | null = null;
    if (isUuid(ref)) {
      const { data, error } = await sb.from("post_stats").select("*").eq("id", ref.toLowerCase()).maybeSingle();
      if (error) throw dbFail(error, "lecture du post");
      post = data as PostStat | null;
      if (!post) throw new ApiError(404, `Aucun post relevé avec l'id ${ref}.`);
    } else {
      const platform = platformOfUrl(ref);
      if (!platform) {
        throw new ApiError(400, `« ${ref} » n'est ni un id de post ni un lien ${STATS_PLATFORM_LIST.join(" / ")} reconnu.`);
      }
      const external = postIdFromUrl(platform, ref);
      if (!external) throw new ApiError(400, `Impossible de lire l'identifiant du post dans ce lien ${platform}.`);
      const { data, error } = await sb
        .from("post_stats")
        .select("*")
        .eq("platform", platform)
        .eq("external_id", external)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (error) throw dbFail(error, "lecture du post");
      post = ((data ?? [])[0] as PostStat | undefined) ?? null;
      if (!post) {
        throw new ApiError(404, `Ce post (${platform} ${external}) n'a pas (encore) été relevé : seuls les 12 derniers posts de chaque compte suivi le sont, chaque nuit.`);
      }
    }

    const [folders, accountList, peopleList, histRes, collection] = await Promise.all([
      loadFolderCtx(sb),
      loadAccounts(sb),
      loadPeople(sb),
      sb.from("post_stats_daily").select("day, views, likes, comments, shares, saves").eq("post_stat_id", post.id).order("day"),
      lastCollection(sb),
    ]);
    if (histRes.error) throw dbFail(histRes.error, "lecture de l'historique");
    const links = await linkPostsToContents(sb, [post]);
    const account = accountList.find((a) => a.id === post!.account_id);
    const rows = (histRes.data ?? []) as { day: string; views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null }[];
    const history = rows.map((r, i) => {
      const prev = rows[i - 1];
      return {
        day: r.day,
        ...metricsOf(r),
        views_delta: prev && r.views !== null && prev.views !== null ? r.views - prev.views : null,
      };
    });

    return json({
      post: { ...serializePost(post, account, folders, peopleMap(peopleList), links.get(post.id), appOrigin(req)), caption_full: post.caption },
      history,
      first_seen_at: post.first_seen_at,
      last_collection: collection,
    });
  });
}
