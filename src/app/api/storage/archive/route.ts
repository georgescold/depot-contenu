import { ARCHIVE_SELECT, archiveContentFiles, isFullyPosted, type ArchivableContent } from "@/lib/archive";
import { jsonError, parseUuid, readBody, withMember } from "@/lib/server-auth";
import { getAdminClient } from "@/lib/supabase/admin";

/** « Supprimer les fichiers maintenant » : libère le stockage d'un contenu déjà posté partout. */
export const POST = withMember(async (req) => {
  const body = await readBody(req);
  const id = parseUuid(body.content_id, "Contenu");
  const admin = getAdminClient();
  const { data, error } = await admin.from("contents").select(ARCHIVE_SELECT).eq("id", id).maybeSingle();
  if (error) return jsonError(error.message, 500);
  if (!data) return jsonError("Contenu introuvable.", 404);
  const content = data as unknown as ArchivableContent;
  if (!isFullyPosted(content.publications)) {
    return jsonError("Ce contenu n'est pas encore posté sur tous ses comptes.", 409);
  }
  try {
    const res = await archiveContentFiles(admin, content);
    return Response.json({
      ok: true,
      archived_ids: res.archivedIds,
      freed_bytes: res.freedBytes,
      archived_at: res.archivedAt,
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Suppression impossible.", 502);
  }
});
