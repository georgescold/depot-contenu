import { creditsOfAllTokens } from "@/lib/apify";
import { jsonError, readBody, withMember } from "@/lib/server-auth";
import { ingestPendingRuns, startCollection } from "@/lib/stats-collect";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * POST {}                 : relève les collectes terminées puis renvoie l'état (sans rien lancer)
 * POST { start: true }    : lance une collecte maintenant (consomme du crédit Apify)
 * Réponse : crédit restant par clé (jamais la clé elle-même) et collectes récentes.
 */
export const POST = withMember(async (req) => {
  const body = await readBody(req);
  const admin = getAdminClient();
  await ingestPendingRuns(admin);

  let started = null;
  if (body.start === true) {
    const { data: running } = await admin
      .from("apify_runs")
      .select("id")
      .not("apify_run_id", "is", null)
      .neq("status", "INGESTED")
      .gte("started_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .limit(1);
    if (running?.length) return jsonError("Une collecte est déjà en cours : les résultats arrivent dans quelques minutes.", 409);
    started = await startCollection(admin, "manual");
  }

  const [credits, runs] = await Promise.all([
    creditsOfAllTokens(),
    admin.from("apify_runs").select("platform, status, trigger, items, posts, cost_usd, error, started_at, ingested_at, token_index").order("started_at", { ascending: false }).limit(12),
  ]);
  return Response.json({ started, credits, runs: runs.data ?? [] });
});
