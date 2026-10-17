import { createMultipartUpload, MIN_PART_SIZE, presignPart, presignPut } from "@/lib/b2";
import { ASSET_KIND_LIST, MAX_FILE_MB, MULTIPART_THRESHOLD } from "@/lib/constants";
import { jsonError, parseUuid, readBody, str, withMember } from "@/lib/server-auth";
import { buildStoragePath, guessMime } from "@/lib/storage-path";
import { getAdminClient } from "@/lib/supabase/admin";
import type { AssetKind } from "@/lib/types";

const MAX_PARTS = 10_000;

/**
 * Prépare l'envoi direct d'un fichier vers B2 :
 * - jusqu'à 100 Mo : une URL PUT unique ;
 * - au-delà : envoi en plusieurs parties (une URL par part, puis /api/storage/complete).
 * Le fichier n'est rattaché au contenu qu'ensuite, par /api/storage/register (qui vérifie sa taille réelle).
 */
export const POST = withMember(async (req) => {
  const body = await readBody(req);
  const contentId = parseUuid(body.content_id, "Contenu");
  const kind = str(body, "kind") as AssetKind;
  const name = str(body, "file_name");
  const size = Number(body.size);
  if (!name) return jsonError("Nom de fichier manquant.");
  if (!ASSET_KIND_LIST.includes(kind)) return jsonError("Type de fichier invalide.");
  if (!Number.isFinite(size) || size <= 0) return jsonError("Fichier vide ou taille invalide.");
  if (size > MAX_FILE_MB * 1024 * 1024) {
    return jsonError(`Fichier trop lourd : ${MAX_FILE_MB} Mo maximum par fichier.`, 413);
  }

  const { data: content } = await getAdminClient().from("contents").select("id").eq("id", contentId).maybeSingle();
  if (!content) return jsonError("Contenu introuvable.", 404);

  const path = buildStoragePath(contentId, kind, name);
  const contentType = str(body, "content_type") || guessMime(name);

  if (size <= MULTIPART_THRESHOLD) {
    return Response.json({ mode: "single", path, url: await presignPut(path), content_type: contentType });
  }

  const partSize = Math.max(16 * 1024 * 1024, MIN_PART_SIZE, Math.ceil(size / MAX_PARTS));
  const count = Math.ceil(size / partSize);
  const uploadId = await createMultipartUpload(path, contentType);
  const urls = await Promise.all(Array.from({ length: count }, (_, i) => presignPart(path, uploadId, i + 1)));
  return Response.json({ mode: "multipart", path, upload_id: uploadId, part_size: partSize, urls, content_type: contentType });
});
