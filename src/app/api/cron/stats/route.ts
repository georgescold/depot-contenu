import { connection } from "next/server";
import { jsonError } from "@/lib/server-auth";
import { ingestPendingRuns, startCollection } from "@/lib/stats-collect";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * Collecte quotidienne des statistiques (cron Vercel, vers minuit heure de Paris).
 * Enregistre d'abord les collectes de la veille restées en attente, puis lance celle du jour.
 * Protégé par CRON_SECRET.
 */
export async function GET(req: Request) {
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return jsonError("Non autorisé.", 401);
  try {
    const admin = getAdminClient();
    const pending = await ingestPendingRuns(admin);
    const started = await startCollection(admin, "cron");
    return Response.json({ ok: true, pending, started });
  } catch (e) {
    console.error(e);
    return jsonError(e instanceof Error ? e.message : "Collecte impossible.", 500);
  }
}
