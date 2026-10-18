import { timingSafeEqual } from "node:crypto";
import { jsonError } from "@/lib/server-auth";
import { ingestRun } from "@/lib/stats-collect";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Apify prévient ici quand une collecte se termine : on enregistre ses résultats. */
export async function POST(req: Request) {
  const expected = process.env.APIFY_WEBHOOK_SECRET;
  const given = new URL(req.url).searchParams.get("secret") ?? "";
  if (!expected || !sameSecret(given, expected)) return jsonError("Non autorisé.", 401);

  const body = (await req.json().catch(() => null)) as {
    eventData?: { actorRunId?: string };
    resource?: { id?: string };
  } | null;
  const runId = body?.eventData?.actorRunId ?? body?.resource?.id;
  if (!runId || !/^[A-Za-z0-9]{8,32}$/.test(runId)) return jsonError("Collecte inconnue.");

  try {
    const res = await ingestRun(getAdminClient(), runId);
    return Response.json({ ok: true, ...res });
  } catch (e) {
    console.error(e);
    // 500 : Apify renverra le webhook plus tard
    return jsonError(e instanceof Error ? e.message : "Enregistrement impossible.", 500);
  }
}
