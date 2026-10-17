import { connection } from "next/server";
import { deleteObjects, listObjectsDetailed } from "@/lib/b2";
import { jsonError } from "@/lib/server-auth";
import { getAdminClient } from "@/lib/supabase/admin";

const GRACE_MS = 24 * 3600 * 1000;

/**
 * Nettoyage quotidien (cron Vercel) : supprime de B2 les fichiers qui ne sont rattachés à aucune fiche
 * depuis plus de 24 h (envoi interrompu, onglet fermé, CLI coupé en route…).
 * Protégé par CRON_SECRET (Vercel envoie « Authorization: Bearer <CRON_SECRET> »).
 */
export async function GET(req: Request) {
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return jsonError("Non autorisé.", 401);

  try {
    const admin = getAdminClient();
    const known = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from("assets")
        .select("storage_path")
        .order("id")
        .range(from, from + 999);
      if (error) throw error;
      for (const a of data ?? []) known.add(a.storage_path as string);
      if (!data || data.length < 1000) break;
    }

    const objects = await listObjectsDetailed("");
    const cutoff = Date.now() - GRACE_MS;
    const orphans = objects.filter((o) => !known.has(o.key) && Date.parse(o.lastModified || "0") < cutoff);
    const removed = orphans.length ? await deleteObjects(orphans.map((o) => o.key)) : 0;
    const freed = orphans.reduce((n, o) => n + o.size, 0);
    return Response.json({ ok: true, objects: objects.length, assets: known.size, removed, freed_bytes: freed });
  } catch (e) {
    console.error(e);
    return jsonError(e instanceof Error ? e.message : "Nettoyage impossible.", 500);
  }
}
