import { contentIdOfPath, deleteObjects, headObject, isStoragePath } from "@/lib/b2";
import { ASSET_KIND_LIST, MAX_FILE_MB } from "@/lib/constants";
import { jsonError, parseUuid, readBody, str, withMember } from "@/lib/server-auth";
import { guessMime } from "@/lib/storage-path";
import { getAdminClient } from "@/lib/supabase/admin";
import type { AssetKind } from "@/lib/types";

/**
 * Rattache un fichier envoyé à son contenu : vérifie qu'il existe vraiment dans B2 et sa taille réelle,
 * calcule sa position (à la suite des fichiers du même type) et crée la ligne `assets`.
 * En cas de refus, le fichier est supprimé du stockage (pas d'orphelin).
 */
export const POST = withMember(async (req, member) => {
  const body = await readBody(req);
  const contentId = parseUuid(body.content_id, "Contenu");
  const path = body.path;
  const kind = str(body, "kind") as AssetKind;
  const fileName = (str(body, "file_name") || "").slice(0, 300);
  if (!isStoragePath(path) || contentIdOfPath(path) !== contentId) return jsonError("Chemin de fichier invalide.");
  if (!ASSET_KIND_LIST.includes(kind) || path.split("/")[1] !== kind) return jsonError("Type de fichier invalide.");
  if (!fileName) return jsonError("Nom de fichier manquant.");

  const admin = getAdminClient();
  const discard = () => deleteObjects([path]).catch((e) => console.error("Nettoyage impossible :", e));

  const { data: content } = await admin.from("contents").select("id").eq("id", contentId).maybeSingle();
  if (!content) {
    await discard();
    return jsonError("Contenu introuvable (supprimé pendant l'envoi ?).", 404);
  }
  const info = await headObject(path);
  if (!info) return jsonError("Le fichier n'est pas arrivé dans le stockage, réessaie.", 400);
  if ((info.size ?? 0) > MAX_FILE_MB * 1024 * 1024) {
    await discard();
    return jsonError(`Fichier trop lourd : ${MAX_FILE_MB} Mo maximum par fichier.`, 413);
  }

  const { data: existing } = await admin.from("assets").select("id, position").eq("content_id", contentId).eq("kind", kind);
  const position = (existing ?? []).reduce((max, a) => Math.max(max, a.position + 1), 0);

  const { data: row, error } = await admin
    .from("assets")
    .insert({
      content_id: contentId,
      kind,
      position,
      storage_path: path,
      file_name: fileName,
      mime_type: str(body, "content_type") || info.contentType || guessMime(fileName),
      size_bytes: info.size ?? 0,
      created_by: member.user.id,
    })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") return jsonError("Ce fichier est déjà enregistré.", 409);
    await discard();
    return jsonError(error.message, 500);
  }
  return Response.json({ asset: row });
});
