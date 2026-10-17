import { deleteObjects, listObjects } from "@/lib/b2";
import { jsonError, parseUuid, readBody, withMember } from "@/lib/server-auth";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Supprime un contenu (`content_id`) ou un fichier (`asset_id`) : d'abord la base (transaction, cascade),
 * puis les fichiers dans B2. Un échec côté stockage ne laisse jamais une fiche pointer vers un fichier disparu ;
 * les éventuels restes sont rattrapés par le nettoyage quotidien.
 */
export const POST = withMember(async (req) => {
  const body = await readBody(req);
  const admin = getAdminClient();

  if (body.content_id !== undefined) {
    const id = parseUuid(body.content_id, "Contenu");
    const { data: assets } = await admin.from("assets").select("storage_path").eq("content_id", id);
    const { data: deleted, error } = await admin.from("contents").delete().eq("id", id).select("id");
    if (error) return jsonError(error.message, 500);
    if (!deleted?.length) return jsonError("Contenu introuvable.", 404);
    let removed = 0;
    let warning: string | undefined;
    try {
      const paths = (assets ?? []).map((a) => a.storage_path as string);
      paths.push(...(await listObjects(`${id}/`))); // fichiers envoyés mais jamais enregistrés
      removed = await deleteObjects(paths);
    } catch (e) {
      warning = e instanceof Error ? e.message : String(e);
      console.error(warning);
    }
    return Response.json({ ok: true, removed, ...(warning ? { warning } : {}) });
  }

  if (body.asset_id !== undefined) {
    const id = parseUuid(body.asset_id, "Fichier");
    const { data: asset, error } = await admin.from("assets").delete().eq("id", id).select("storage_path").maybeSingle();
    if (error) return jsonError(error.message, 500);
    if (!asset) return jsonError("Fichier introuvable.", 404);
    let warning: string | undefined;
    try {
      await deleteObjects([asset.storage_path as string]);
    } catch (e) {
      warning = e instanceof Error ? e.message : String(e);
      console.error(warning);
    }
    return Response.json({ ok: true, ...(warning ? { warning } : {}) });
  }

  return jsonError("Rien à supprimer.");
});
